#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { toolSchemas } from './schemas.js';
import { toMcpError } from './errors.js';
import { VaultReader } from './vault.js';
import { KnowledgeGraph } from './graph.js';
import { ContextEngine } from './context.js';
import { loadExecutionConfig } from './execution-config.js';
import { AuditLogger } from './audit.js';
import { SafeCommandRunner } from './safe-command-runner.js';
import { registerExecutionTools } from './execution.js';

const SERVER_NAME = 'obsidian-mcp';
const SERVER_VERSION = '1.1.0';
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
  const commandRunner = new SafeCommandRunner(new AuditLogger(), env);

  // Resolve real path for graph
  const { promises: fsPromises } = await import('node:fs');
  const resolvedRoot = await fsPromises.realpath(vaultRoot);

  const graph = new KnowledgeGraph(resolvedRoot, maxFileBytes);
  const contextEngine = new ContextEngine(graph, resolvedRoot, maxFileBytes);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  /* ================================================================ */
  /*  Vault tools (unchanged)                                         */
  /* ================================================================ */

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
        const output = await reader.listNotes(input);
        return toToolResult(output);
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
        const output = await reader.readNote(input);
        return toToolResult(output);
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
        const output = await reader.searchNotes(input);
        return toToolResult(output);
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
        const output = await reader.getMetadata(input);
        return toToolResult(output);
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  /* ================================================================ */
  /*  Graph tools (new)                                                */
  /* ================================================================ */

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
        const stats = await graph.build();
        return toToolResult(stats);
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
      description:
        'Get all notes that link to the specified note. Graph must be built first.',
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

  /* ================================================================ */
  /*  Context tool (new)                                               */
  /* ================================================================ */

  server.registerTool(
    'context.gather',
    {
      description:
        'Gather related context for a note using the knowledge graph. Returns scored related notes with snippets, ranked by relationship strength (direct link > backlink > shared tag > 2-hop). Graph is auto-built on first call.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.contextGatherInputSchema.shape,
      outputSchema: toolSchemas.contextGatherOutputSchema.shape
    },
    async (input) => {
      try {
        await ensureGraphBuilt(graph);
        const result = await contextEngine.gatherContext(
          input.path,
          input.maxNotes ?? 10,
          input.maxTotalBytes ?? 50_000
        );
        return toToolResult(result);
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  registerExecutionTools(server, executionConfig, commandRunner);

  return server;
}

/** Auto-build graph on first query if not already built. */
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

if (isMainModule()) {
  main().catch((error) => {
    console.error('FATAL', error);
    process.exit(1);
  });
}
