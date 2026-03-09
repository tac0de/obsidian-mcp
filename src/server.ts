#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuditLogger } from './audit.js';
import { ContextEngine } from './context.js';
import { loadEmbeddingConfig, loadPlanningConfig } from './embedding-config.js';
import { OpenAIEmbeddingProvider, OpenAIPlanningProvider } from './embedding-provider.js';
import { EmbeddingStore } from './embedding-store.js';
import { toMcpError } from './errors.js';
import { executionInternals, registerExecutionTools } from './execution.js';
import { loadExecutionConfig } from './execution-config.js';
import { KnowledgeGraph } from './graph.js';
import { buildDeterministicPlan, PlanService } from './plan.js';
import { RetrievalService, buildAgentPacket } from './retrieval.js';
import { SafeCommandRunner } from './safe-command-runner.js';
import { toolSchemas } from './schemas.js';
import { VaultReader } from './vault.js';

const SERVER_NAME = 'knowledge-to-action-mcp';
const SERVER_VERSION = '2.1.0';
const DEFAULT_MAX_FILE_BYTES = 262_144;

function getMaxFileBytes(env: NodeJS.ProcessEnv): number {
  const raw = env.MAX_FILE_BYTES;
  if (!raw) {
    return DEFAULT_MAX_FILE_BYTES;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('MAX_FILE_BYTES must be a positive number');
  }
  return Math.floor(parsed);
}

function toToolResult<T extends object>(payload: T) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

interface CreateServerOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export async function createServer(options: CreateServerOptions = {}): Promise<McpServer> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const vaultRoot = getEnvFrom(env, 'OBSIDIAN_VAULT_ROOT');
  const maxFileBytes = getMaxFileBytes(env);
  const reader = await VaultReader.create(vaultRoot, maxFileBytes);
  const executionConfig = await loadExecutionConfig(env, cwd);
  const embeddingConfig = await loadEmbeddingConfig(env, cwd);
  const planningConfig = loadPlanningConfig(env);
  const commandRunner = new SafeCommandRunner(new AuditLogger(), env);

  const { promises: fsPromises } = await import('node:fs');
  const resolvedRoot = await fsPromises.realpath(vaultRoot);

  const graph = new KnowledgeGraph(resolvedRoot, maxFileBytes);
  const contextEngine = new ContextEngine(graph, resolvedRoot, maxFileBytes);
  const retrievalService = new RetrievalService({
    reader,
    graph,
    contextEngine,
    embeddingConfig,
    createProvider: () =>
      new OpenAIEmbeddingProvider({
        apiKey: embeddingConfig.apiKey,
        model: embeddingConfig.model
      })
  });
  const planService = new PlanService({
    reader,
    planningConfig,
    createProvider: () =>
      new OpenAIPlanningProvider({
        apiKey: planningConfig.apiKey,
        model: planningConfig.model
      }),
    retrievalService
  });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  server.registerTool(
    'vault.list_notes',
    {
      description: 'List notes in the vault using deterministic ordering.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.listNotesInputSchema.shape,
      outputSchema: toolSchemas.listNotesOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(await reader.listNotes(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'vault.read_note',
    {
      description: 'Read one note from the vault and return stable hash metadata.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.readNoteInputSchema.shape,
      outputSchema: toolSchemas.readNoteOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(await reader.readNote(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'vault.search_notes',
    {
      description: 'Search note contents in deterministic order.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.searchNotesInputSchema.shape,
      outputSchema: toolSchemas.searchNotesOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(await reader.searchNotes(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'vault.get_metadata',
    {
      description: 'Return frontmatter and metadata from a note.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.getMetadataInputSchema.shape,
      outputSchema: toolSchemas.getMetadataOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(await reader.getMetadata(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'graph.build',
    {
      description:
        'Build the knowledge graph from the vault. Parses all wikilinks, tags, and computes backlinks. Must be called before using other graph/context tools.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.graphBuildInputSchema.shape,
      outputSchema: toolSchemas.graphBuildOutputSchema.shape
    },
    async () => {
      try {
        return toToolResult(await graph.build());
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'graph.get_neighbors',
    {
      description:
        'Get neighbor nodes of a note in the knowledge graph (BFS traversal). Includes outLinks, backLinks, and shared-tag neighbors. Graph must be built first.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.graphGetNeighborsInputSchema.shape,
      outputSchema: toolSchemas.graphGetNeighborsOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        const neighbors = graph.getNeighbors(input.path, input.depth ?? 1);
        return toToolResult({
          source: input.path,
          neighbors,
          total: neighbors.length
        });
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'graph.get_backlinks',
    {
      description: 'Get all notes that link to the specified note. Graph must be built first.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.graphGetBacklinksInputSchema.shape,
      outputSchema: toolSchemas.graphGetBacklinksOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        const backlinks = graph.getBacklinks(input.path);
        return toToolResult({
          source: input.path,
          backlinks,
          total: backlinks.length
        });
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'context.gather',
    {
      description:
        'Gather related context for a note using the knowledge graph. Returns scored related notes with snippets, ranked by relationship strength.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.contextGatherInputSchema.shape,
      outputSchema: toolSchemas.contextGatherOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        return toToolResult(
          await contextEngine.gatherContext(input.path, input.maxNotes ?? 10, input.maxTotalBytes ?? 50_000)
        );
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'embeddings.index_vault',
    {
      description: 'Chunk vault notes and persist optional embeddings to a local SQLite index.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: toolSchemas.embeddingsIndexVaultInputSchema.shape,
      outputSchema: toolSchemas.embeddingsIndexVaultOutputSchema.shape
    },
    async (input) => {
      try {
        if (!embeddingConfig.enabled) {
          throw new Error('E_EMBEDDINGS_DISABLED: Set EMBEDDINGS_ENABLED=true to use embeddings.index_vault');
        }

        const store = await EmbeddingStore.open(embeddingConfig.sqlitePath);
        const provider = new OpenAIEmbeddingProvider({
          apiKey: embeddingConfig.apiKey,
          model: embeddingConfig.model
        });

        return toToolResult(
          await store.indexVault(reader, provider, {
            glob: input.glob,
            maxNotes: input.maxNotes,
            chunkSize: input.chunkSize,
            chunkOverlap: input.chunkOverlap,
            forceReindex: input.forceReindex
          })
        );
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'context.retrieve',
    {
      description: 'Retrieve notes using lexical, graph, and optional embedding-based reranking.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.contextRetrieveInputSchema.shape,
      outputSchema: toolSchemas.contextRetrieveOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(await retrievalService.retrieve(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'context.bundle_for_agent',
    {
      description: 'Build an agent-ready context packet from a note and related vault context.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.contextBundleForAgentInputSchema.shape,
      outputSchema: toolSchemas.contextBundleForAgentOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        const handoff = input.includeRepoHints
          ? await buildRepoHandoff({
              path: input.path,
              workspacePath: input.workspacePath,
              queryHints: undefined,
              maxMatches: 12,
              reader,
              commandRunner,
              executionRoot: executionConfig.workspaceRoot
            })
          : undefined;

        return toToolResult(
          await buildAgentPacket({
            path: input.path,
            objective: input.objective,
            reader,
            contextEngine,
            graph,
            retrievalService,
            workspaceSummary: handoff
              ? { matchedFiles: handoff.matchedFiles, warnings: handoff.warnings }
              : undefined,
            maxNotes: input.maxNotes,
            maxTotalBytes: input.maxTotalBytes
          })
        );
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'action.plan_from_note',
    {
      description: 'Create a preview-only action plan from a note and nearby context.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.actionPlanFromNoteInputSchema.shape,
      outputSchema: toolSchemas.actionPlanFromNoteOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        return toToolResult(await planService.planFromNote(input));
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  server.registerTool(
    'action.handoff_to_repo',
    {
      description: 'Connect note context to a related workspace using read-only inspection commands.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.actionHandoffToRepoInputSchema.shape,
      outputSchema: toolSchemas.actionHandoffToRepoOutputSchema.shape
    },
    async (input) => {
      try {
        return toToolResult(
          await buildRepoHandoff({
            path: input.path,
            workspacePath: input.workspacePath,
            queryHints: input.queryHints,
            maxMatches: input.maxMatches,
            reader,
            commandRunner,
            executionRoot: executionConfig.workspaceRoot
          })
        );
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  registerExecutionTools(server, executionConfig, commandRunner);

  return server;
}

async function buildRepoHandoff(input: {
  path: string;
  workspacePath?: string;
  queryHints?: string[];
  maxMatches?: number;
  reader: VaultReader;
  commandRunner: SafeCommandRunner;
  executionRoot: string;
}): Promise<{
  noteSummary: string;
  matchedFiles: string[];
  ripgrepHits: Array<{ path: string; lineNumber: number; line: string }>;
  gitStatus: {
    branch?: string;
    entries: Array<{ path: string; status: string; originalPath?: string }>;
    total: number;
  };
  nextSteps: string[];
  warnings: string[];
}> {
  const note = await input.reader.readNote({ path: input.path });
  const metadata = await input.reader.getMetadata({ path: input.path });
  const workspaceRoot = await executionInternals.resolveWorkspacePath(input.executionRoot, input.workspacePath ?? '.');
  const relativeWorkspace = executionInternals.normalizeRelativePath(input.executionRoot, workspaceRoot);
  const queries = uniqueStrings([
    ...(input.queryHints ?? []),
    metadata.title ?? '',
    ...metadata.tags,
    ...extractQueryHints(note.content)
  ]).slice(0, 6);
  const maxMatches = clampInt(input.maxMatches, 20, 1, 100);
  const warnings: string[] = [];

  const allHits: Array<{ path: string; lineNumber: number; line: string }> = [];
  for (const query of queries) {
    if (!query) {
      continue;
    }

    try {
      const result = await input.commandRunner.run({
        tool: 'action.handoff_to_repo',
        capability: 'workspace.search',
        command: 'rg',
        args: ['--json', '--line-number', '--color', 'never', query, '.'],
        cwd: workspaceRoot,
        timeoutMs: 5_000,
        maxOutputBytes: 32_768
      });
      allHits.push(...executionInternals.parseRipgrepJson(result.stdout));
    } catch {
      warnings.push(`Search failed for query: ${query}`);
    }
  }

  const ripgrepHits = uniqueRipgrepHits(allHits).slice(0, maxMatches);
  const matchedFiles = [...new Set(ripgrepHits.map((hit) => hit.path))];

  let gitStatus: {
    branch?: string;
    entries: Array<{ path: string; status: string; originalPath?: string }>;
    total: number;
  } = {
    branch: undefined,
    entries: [],
    total: 0
  };

  try {
    const result = await input.commandRunner.run({
      tool: 'action.handoff_to_repo',
      capability: 'workspace.git_status',
      command: 'git',
      args: ['status', '--short', '--branch', '--porcelain=v1'],
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      maxOutputBytes: 32_768
    });
    const parsed = executionInternals.parseGitStatus(result.stdout);
    gitStatus = {
      branch: parsed.branch,
      entries: parsed.entries,
      total: parsed.entries.length
    };
  } catch {
    warnings.push(`Git status unavailable for workspace: ${relativeWorkspace}`);
  }

  return {
    noteSummary: summarizeContent(note.content, metadata.title || input.path),
    matchedFiles,
    ripgrepHits,
    gitStatus,
    nextSteps: buildNextSteps(matchedFiles, warnings),
    warnings
  };
}

async function ensureGraphBuilt(graph: KnowledgeGraph): Promise<void> {
  if (!graph.isBuilt) {
    await graph.build();
  }
}

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);
}

function getEnvFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

function summarizeContent(content: string, fallback: string): string {
  const stripped = content.replace(/^---[\s\S]*?^---\s*/m, '').replace(/\s+/g, ' ').trim();
  if (!stripped) {
    return fallback;
  }

  const sentence = stripped.match(/.*?[.!?](?:\s|$)/)?.[0] ?? stripped.slice(0, 180);
  return sentence.trim();
}

function extractQueryHints(content: string): string[] {
  return content
    .replace(/^---[\s\S]*?^---\s*/m, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /^#+\s+/.test(line) || /`[^`]+`/.test(line))
    .flatMap((line) => line.replace(/^#+\s+/, '').match(/[A-Za-z0-9_-]{4,}/g) ?? []);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function uniqueRipgrepHits(hits: Array<{ path: string; lineNumber: number; line: string }>) {
  const map = new Map<string, { path: string; lineNumber: number; line: string }>();
  for (const hit of hits) {
    map.set(`${hit.path}:${hit.lineNumber}:${hit.line}`, hit);
  }

  return [...map.values()].sort((a, b) => {
    if (a.path === b.path) {
      return a.lineNumber - b.lineNumber;
    }
    return a.path.localeCompare(b.path);
  });
}

function buildNextSteps(matchedFiles: string[], warnings: string[]): string[] {
  const steps = [
    ...(matchedFiles.length > 0 ? [`Review matched files: ${matchedFiles.slice(0, 3).join(', ')}`] : []),
    ...(warnings.length > 0 ? ['Resolve workspace warnings before acting on this handoff.'] : []),
    'Use the plan output as preview-only context before making repo changes.'
  ];

  return uniqueStrings(steps);
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(value), min), max);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('FATAL', error);
    process.exit(1);
  });
}
