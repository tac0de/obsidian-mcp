import * as z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const toJsonSchema = zodToJsonSchema as unknown as (schema: unknown, name: string) => Record<string, unknown>;

const listNotesInputSchema = z.object({
  folder: z.string().optional(),
  glob: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional()
});

const listNotesOutputSchema = z.object({
  notes: z.array(z.string()),
  total: z.number().int().nonnegative()
});

const readNoteInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().min(1).max(10_000_000).optional()
});

const readNoteOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  lineCount: z.number().int().nonnegative()
});

const searchNotesInputSchema = z.object({
  query: z.string(),
  caseSensitive: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional()
});

const searchNotesOutputSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      lineNumber: z.number().int().positive(),
      line: z.string()
    })
  ),
  total: z.number().int().nonnegative()
});

const getMetadataInputSchema = z.object({
  path: z.string().min(1)
});

const getMetadataOutputSchema = z.object({
  path: z.string(),
  title: z.string().optional(),
  tags: z.array(z.string()),
  frontmatter: z.record(z.string(), z.unknown())
});

/* ------------------------------------------------------------------ */
/*  Graph & Context schemas                                            */
/* ------------------------------------------------------------------ */

const graphBuildInputSchema = z.object({});

const graphBuildOutputSchema = z.object({
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  buildTimeMs: z.number().nonnegative()
});

const graphGetNeighborsInputSchema = z.object({
  path: z.string().min(1),
  depth: z.number().int().min(1).max(5).optional()
});

const graphGetNeighborsOutputSchema = z.object({
  source: z.string(),
  neighbors: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      relationship: z.enum(['outLink', 'backLink', 'sharedTag']),
      depth: z.number().int().positive()
    })
  ),
  total: z.number().int().nonnegative()
});

const graphGetBacklinksInputSchema = z.object({
  path: z.string().min(1)
});

const graphGetBacklinksOutputSchema = z.object({
  source: z.string(),
  backlinks: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional()
    })
  ),
  total: z.number().int().nonnegative()
});

const contextGatherInputSchema = z.object({
  path: z.string().min(1),
  maxNotes: z.number().int().min(1).max(50).optional(),
  maxTotalBytes: z.number().int().min(1000).max(500_000).optional()
});

const contextGatherOutputSchema = z.object({
  source: z.string(),
  relatedNotes: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      score: z.number(),
      relationship: z.string(),
      snippet: z.string()
    })
  ),
  totalNodes: z.number().int().nonnegative(),
  graphDepth: z.number().int().nonnegative()
});

const embeddingsIndexVaultInputSchema = z.object({
  glob: z.string().optional(),
  maxNotes: z.number().int().min(1).max(5000).optional(),
  chunkSize: z.number().int().min(200).max(4000).optional(),
  chunkOverlap: z.number().int().min(0).max(2000).optional(),
  forceReindex: z.boolean().optional()
});

const embeddingsIndexVaultOutputSchema = z.object({
  notesIndexed: z.number().int().nonnegative(),
  chunksIndexed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  provider: z.string(),
  durationMs: z.number().nonnegative()
});

const retrievalScoreSchema = z.object({
  lexical: z.number().nonnegative(),
  graph: z.number().nonnegative(),
  embedding: z.number().nonnegative(),
  final: z.number().nonnegative()
});

const contextRetrieveInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  maxTotalBytes: z.number().int().min(1000).max(500_000).optional(),
  useEmbeddings: z.boolean().optional()
});

const contextRetrieveOutputSchema = z.object({
  query: z.string(),
  sourcePath: z.string().optional(),
  retrievalMode: z.enum(['graph', 'hybrid']),
  results: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      snippet: z.string(),
      relationship: z.string(),
      scores: retrievalScoreSchema
    })
  ),
  total: z.number().int().nonnegative()
});

const contextBundleForAgentInputSchema = z.object({
  path: z.string().min(1),
  objective: z.string().optional(),
  maxNotes: z.number().int().min(1).max(20).optional(),
  maxTotalBytes: z.number().int().min(1000).max(500_000).optional(),
  workspacePath: z.string().optional(),
  includeRepoHints: z.boolean().optional()
});

const contextBundleForAgentOutputSchema = z.object({
  brief: z.string(),
  objective: z.string().optional(),
  source: z.string(),
  relatedNotes: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      score: z.number(),
      relationship: z.string(),
      snippet: z.string()
    })
  ),
  keyFacts: z.array(z.string()),
  openQuestions: z.array(z.string()),
  risks: z.array(z.string()),
  repoHints: z.object({
    matchedFiles: z.array(z.string()),
    suggestedQueries: z.array(z.string())
  }),
  packet: z.object({
    source: z.string(),
    objective: z.string().optional(),
    summary: z.string(),
    facts: z.array(z.string()),
    questions: z.array(z.string()),
    risks: z.array(z.string()),
    relatedNotes: z.array(
      z.object({
        path: z.string(),
        relationship: z.string(),
        score: z.number()
      })
    ),
    retrieval: z.array(
      z.object({
        path: z.string(),
        title: z.string().optional(),
        snippet: z.string(),
        relationship: z.string(),
        scores: retrievalScoreSchema
      })
    ),
    repoHints: z.object({
      matchedFiles: z.array(z.string()),
      suggestedQueries: z.array(z.string())
    })
  })
});

const actionPlanFromNoteInputSchema = z.object({
  path: z.string().min(1),
  objective: z.string().optional(),
  style: z.enum(['implementation', 'research', 'content', 'ops']).optional(),
  useModel: z.boolean().optional(),
  maxRelatedNotes: z.number().int().min(1).max(20).optional()
});

const actionPlanFromNoteOutputSchema = z.object({
  source: z.string(),
  summary: z.string(),
  goals: z.array(z.string()),
  constraints: z.array(z.string()),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedActions: z.array(z.string()),
  handoffPrompt: z.string(),
  generationMode: z.enum(['deterministic', 'llm'])
});

const actionHandoffToRepoInputSchema = z.object({
  path: z.string().min(1),
  workspacePath: z.string().optional(),
  queryHints: z.array(z.string()).optional(),
  maxMatches: z.number().int().min(1).max(100).optional()
});

const actionHandoffToRepoOutputSchema = z.object({
  noteSummary: z.string(),
  matchedFiles: z.array(z.string()),
  ripgrepHits: z.array(
    z.object({
      path: z.string(),
      lineNumber: z.number().int().positive(),
      line: z.string()
    })
  ),
  gitStatus: z.object({
    branch: z.string().optional(),
    entries: z.array(
      z.object({
        path: z.string(),
        status: z.string(),
        originalPath: z.string().optional()
      })
    ),
    total: z.number().int().nonnegative()
  }),
  nextSteps: z.array(z.string()),
  warnings: z.array(z.string())
});

const execListCapabilitiesInputSchema = z.object({});

const execListCapabilitiesOutputSchema = z.object({
  capabilities: z.array(
    z.object({
      name: z.string(),
      tool: z.string(),
      description: z.string()
    })
  ),
  total: z.number().int().nonnegative()
});

const execRgSearchInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional()
});

const execRgSearchOutputSchema = z.object({
  query: z.string(),
  path: z.string(),
  matches: z.array(
    z.object({
      path: z.string(),
      lineNumber: z.number().int().positive(),
      line: z.string()
    })
  ),
  total: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative()
});

const execListDirInputSchema = z.object({
  path: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional()
});

const execListDirOutputSchema = z.object({
  path: z.string(),
  entries: z.array(
    z.object({
      name: z.string()
    })
  ),
  total: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative()
});

const execGitStatusInputSchema = z.object({});

const execGitStatusOutputSchema = z.object({
  branch: z.string().optional(),
  entries: z.array(
    z.object({
      path: z.string(),
      status: z.string(),
      originalPath: z.string().optional()
    })
  ),
  total: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative()
});

export const toolSchemas = {
  listNotesInputSchema,
  listNotesOutputSchema,
  readNoteInputSchema,
  readNoteOutputSchema,
  searchNotesInputSchema,
  searchNotesOutputSchema,
  getMetadataInputSchema,
  getMetadataOutputSchema,
  graphBuildInputSchema,
  graphBuildOutputSchema,
  graphGetNeighborsInputSchema,
  graphGetNeighborsOutputSchema,
  graphGetBacklinksInputSchema,
  graphGetBacklinksOutputSchema,
  contextGatherInputSchema,
  contextGatherOutputSchema,
  embeddingsIndexVaultInputSchema,
  embeddingsIndexVaultOutputSchema,
  contextRetrieveInputSchema,
  contextRetrieveOutputSchema,
  contextBundleForAgentInputSchema,
  contextBundleForAgentOutputSchema,
  actionPlanFromNoteInputSchema,
  actionPlanFromNoteOutputSchema,
  actionHandoffToRepoInputSchema,
  actionHandoffToRepoOutputSchema,
  execListCapabilitiesInputSchema,
  execListCapabilitiesOutputSchema,
  execRgSearchInputSchema,
  execRgSearchOutputSchema,
  execListDirInputSchema,
  execListDirOutputSchema,
  execGitStatusInputSchema,
  execGitStatusOutputSchema
} as const;

export const toolJsonSchemas = {
  'vault.list_notes': {
    input: toJsonSchema(listNotesInputSchema, 'vault.list_notes.input'),
    output: toJsonSchema(listNotesOutputSchema, 'vault.list_notes.output')
  },
  'vault.read_note': {
    input: toJsonSchema(readNoteInputSchema, 'vault.read_note.input'),
    output: toJsonSchema(readNoteOutputSchema, 'vault.read_note.output')
  },
  'vault.search_notes': {
    input: toJsonSchema(searchNotesInputSchema, 'vault.search_notes.input'),
    output: toJsonSchema(searchNotesOutputSchema, 'vault.search_notes.output')
  },
  'vault.get_metadata': {
    input: toJsonSchema(getMetadataInputSchema, 'vault.get_metadata.input'),
    output: toJsonSchema(getMetadataOutputSchema, 'vault.get_metadata.output')
  },
  'graph.build': {
    input: toJsonSchema(graphBuildInputSchema, 'graph.build.input'),
    output: toJsonSchema(graphBuildOutputSchema, 'graph.build.output')
  },
  'graph.get_neighbors': {
    input: toJsonSchema(graphGetNeighborsInputSchema, 'graph.get_neighbors.input'),
    output: toJsonSchema(graphGetNeighborsOutputSchema, 'graph.get_neighbors.output')
  },
  'graph.get_backlinks': {
    input: toJsonSchema(graphGetBacklinksInputSchema, 'graph.get_backlinks.input'),
    output: toJsonSchema(graphGetBacklinksOutputSchema, 'graph.get_backlinks.output')
  },
  'context.gather': {
    input: toJsonSchema(contextGatherInputSchema, 'context.gather.input'),
    output: toJsonSchema(contextGatherOutputSchema, 'context.gather.output')
  },
  'embeddings.index_vault': {
    input: toJsonSchema(embeddingsIndexVaultInputSchema, 'embeddings.index_vault.input'),
    output: toJsonSchema(embeddingsIndexVaultOutputSchema, 'embeddings.index_vault.output')
  },
  'context.retrieve': {
    input: toJsonSchema(contextRetrieveInputSchema, 'context.retrieve.input'),
    output: toJsonSchema(contextRetrieveOutputSchema, 'context.retrieve.output')
  },
  'context.bundle_for_agent': {
    input: toJsonSchema(contextBundleForAgentInputSchema, 'context.bundle_for_agent.input'),
    output: toJsonSchema(contextBundleForAgentOutputSchema, 'context.bundle_for_agent.output')
  },
  'action.plan_from_note': {
    input: toJsonSchema(actionPlanFromNoteInputSchema, 'action.plan_from_note.input'),
    output: toJsonSchema(actionPlanFromNoteOutputSchema, 'action.plan_from_note.output')
  },
  'action.handoff_to_repo': {
    input: toJsonSchema(actionHandoffToRepoInputSchema, 'action.handoff_to_repo.input'),
    output: toJsonSchema(actionHandoffToRepoOutputSchema, 'action.handoff_to_repo.output')
  },
  'exec.list_capabilities': {
    input: toJsonSchema(execListCapabilitiesInputSchema, 'exec.list_capabilities.input'),
    output: toJsonSchema(execListCapabilitiesOutputSchema, 'exec.list_capabilities.output')
  },
  'exec.rg_search': {
    input: toJsonSchema(execRgSearchInputSchema, 'exec.rg_search.input'),
    output: toJsonSchema(execRgSearchOutputSchema, 'exec.rg_search.output')
  },
  'exec.list_dir': {
    input: toJsonSchema(execListDirInputSchema, 'exec.list_dir.input'),
    output: toJsonSchema(execListDirOutputSchema, 'exec.list_dir.output')
  },
  'exec.git_status': {
    input: toJsonSchema(execGitStatusInputSchema, 'exec.git_status.input'),
    output: toJsonSchema(execGitStatusOutputSchema, 'exec.git_status.output')
  }
} as const;
