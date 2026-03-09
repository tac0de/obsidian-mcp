import path from 'node:path';
import type { ContextEngine } from './context.js';
import type { EmbeddingConfig } from './embedding-config.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import { EmbeddingStore } from './embedding-store.js';
import type { KnowledgeGraph } from './graph.js';
import { VaultError } from './errors.js';
import type { VaultReader } from './vault.js';

const WEIGHT_LEXICAL = 0.35;
const WEIGHT_GRAPH = 0.3;
const WEIGHT_EMBEDDING = 0.35;

export interface RetrievalResultItem {
  path: string;
  title?: string;
  snippet: string;
  relationship: string;
  scores: {
    lexical: number;
    graph: number;
    embedding: number;
    final: number;
  };
}

export interface RetrievalResult {
  [key: string]: unknown;
  query: string;
  sourcePath?: string;
  retrievalMode: 'graph' | 'hybrid';
  results: RetrievalResultItem[];
  total: number;
}

export class RetrievalService {
  private readonly reader: VaultReader;
  private readonly graph: KnowledgeGraph;
  private readonly contextEngine: ContextEngine;
  private readonly embeddingConfig: EmbeddingConfig;
  private readonly createProvider: () => EmbeddingProvider;

  constructor(options: {
    reader: VaultReader;
    graph: KnowledgeGraph;
    contextEngine: ContextEngine;
    embeddingConfig: EmbeddingConfig;
    createProvider: () => EmbeddingProvider;
  }) {
    this.reader = options.reader;
    this.graph = options.graph;
    this.contextEngine = options.contextEngine;
    this.embeddingConfig = options.embeddingConfig;
    this.createProvider = options.createProvider;
  }

  async retrieve(input: {
    query: string;
    path?: string;
    maxResults?: number;
    maxTotalBytes?: number;
    useEmbeddings?: boolean;
  }): Promise<RetrievalResult> {
    const query = input.query.trim();
    if (!query) {
      throw new VaultError('E_EMPTY_QUERY', 'Query must not be empty');
    }

    const maxResults = clampInt(input.maxResults, 10, 1, 50);
    const maxTotalBytes = clampInt(input.maxTotalBytes, 50_000, 1_000, 500_000);

    const lexical = await this.reader.searchNotes({
      query,
      limit: maxResults * 8
    });

    let graphContext: Awaited<ReturnType<ContextEngine['gatherContext']>> | undefined;
    if (input.path) {
      if (!this.graph.isBuilt) {
        await this.graph.build();
      }
      graphContext = await this.contextEngine.gatherContext(input.path, maxResults * 5, maxTotalBytes);
    }

    const lexicalScores = new Map<string, { score: number; line: string }>();
    const lexicalCounts = new Map<string, number>();
    for (const match of lexical.matches) {
      lexicalCounts.set(match.path, (lexicalCounts.get(match.path) ?? 0) + 1);
      if (!lexicalScores.has(match.path)) {
        lexicalScores.set(match.path, { score: 0, line: match.line });
      }
    }

    const maxLexical = Math.max(1, ...lexicalCounts.values());
    for (const [notePath, count] of lexicalCounts) {
      const current = lexicalScores.get(notePath);
      if (current) {
        current.score = count / maxLexical;
      }
    }

    const graphScores = new Map<string, { score: number; snippet: string; relationship: string }>();
    const maxGraph = Math.max(1, ...(graphContext?.relatedNotes.map((note) => note.score) ?? [1]));
    for (const note of graphContext?.relatedNotes ?? []) {
      graphScores.set(note.path, {
        score: note.score / maxGraph,
        snippet: note.snippet,
        relationship: note.relationship
      });
    }

    let embeddingScores = new Map<string, { score: number; snippet: string }>();
    let retrievalMode: 'graph' | 'hybrid' = 'graph';

    const shouldUseEmbeddings = input.useEmbeddings ?? this.embeddingConfig.enabled;
    if (shouldUseEmbeddings && this.embeddingConfig.enabled) {
      const provider = this.createProvider();
      const store = await EmbeddingStore.open(this.embeddingConfig.sqlitePath);
      if (store.countEmbeddings() > 0) {
        const similar = await store.searchSimilar(query, provider, maxResults * 5);
        const maxSimilarity = Math.max(1e-6, ...similar.map((entry) => entry.similarity));
        embeddingScores = new Map(
          similar.map((entry) => [
            entry.notePath,
            {
              score: Math.max(0, entry.similarity / maxSimilarity),
              snippet: entry.text
            }
          ])
        );
        retrievalMode = similar.length > 0 ? 'hybrid' : 'graph';
      }
    }

    const candidatePaths = new Set<string>([
      ...lexicalScores.keys(),
      ...graphScores.keys(),
      ...embeddingScores.keys()
    ]);

    const weights = retrievalMode === 'hybrid'
      ? { lexical: WEIGHT_LEXICAL, graph: WEIGHT_GRAPH, embedding: WEIGHT_EMBEDDING }
      : normalizeWeights({
          lexical: lexicalScores.size > 0 ? WEIGHT_LEXICAL : 0,
          graph: graphScores.size > 0 ? WEIGHT_GRAPH : 0,
          embedding: 0
        });

    const results = await Promise.all(
      [...candidatePaths].map(async (candidatePath) => {
        const lexicalMeta = lexicalScores.get(candidatePath);
        const graphMeta = graphScores.get(candidatePath);
        const embeddingMeta = embeddingScores.get(candidatePath);
        const metadata = await this.reader
          .getMetadata({ path: candidatePath })
          .catch(() => ({ path: candidatePath, title: undefined, tags: [], frontmatter: {} as Record<string, unknown> }));
        const snippet =
          lexicalMeta?.line ||
          embeddingMeta?.snippet ||
          graphMeta?.snippet ||
          (await fallbackSnippet(this.reader, candidatePath, maxTotalBytes));

        const scores = {
          lexical: roundScore(lexicalMeta?.score ?? 0),
          graph: roundScore(graphMeta?.score ?? 0),
          embedding: roundScore(embeddingMeta?.score ?? 0),
          final: 0
        };

        scores.final = roundScore(
          scores.lexical * weights.lexical +
            scores.graph * weights.graph +
            scores.embedding * weights.embedding
        );

        return {
          path: candidatePath,
          title: metadata.title,
          snippet: snippet.slice(0, maxTotalBytes),
          relationship: graphMeta?.relationship ?? (lexicalMeta ? 'lexical' : 'semantic'),
          scores
        } satisfies RetrievalResultItem;
      })
    );

    const ranked = results
      .sort((a, b) => {
        if (b.scores.final !== a.scores.final) {
          return b.scores.final - a.scores.final;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, maxResults);

    return {
      query,
      sourcePath: input.path,
      retrievalMode,
      results: ranked,
      total: ranked.length
    };
  }
}

export async function buildAgentPacket(input: {
  path: string;
  objective?: string;
  reader: VaultReader;
  contextEngine: ContextEngine;
  graph: KnowledgeGraph;
  retrievalService?: RetrievalService;
  workspaceSummary?: {
    matchedFiles: string[];
    warnings: string[];
  };
  maxNotes?: number;
  maxTotalBytes?: number;
}) {
  if (!input.graph.isBuilt) {
    await input.graph.build();
  }

  const source = await input.reader.readNote({ path: input.path });
  const metadata = await input.reader.getMetadata({ path: input.path });
  const related = await input.contextEngine.gatherContext(
    input.path,
    clampInt(input.maxNotes, 6, 1, 20),
    clampInt(input.maxTotalBytes, 30_000, 1_000, 500_000)
  );

  const retrieval = input.objective
    ? await input.retrievalService?.retrieve({
        query: input.objective,
        path: input.path,
        maxResults: 5
      })
    : undefined;

  const brief = firstSentence(source.content) || metadata.title || input.path;
  const keyFacts = uniqueStrings([
    metadata.title ? `Title: ${metadata.title}` : '',
    ...(metadata.tags.length > 0 ? [`Tags: ${metadata.tags.join(', ')}`] : []),
    ...extractLines(source.content, (line) =>
      /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^#+\s+/.test(line)
    ).slice(0, 6),
    ...related.relatedNotes.slice(0, 3).map((note) => `Related: ${note.path} (${note.relationship})`)
  ]);

  const openQuestions = uniqueStrings([
    ...extractLines(source.content, (line) => line.includes('?')),
    ...extractLines(source.content, (line) => /\b(todo|tbd|unknown|question)\b/i.test(line))
  ]).slice(0, 6);

  const risks = uniqueStrings([
    ...extractLines(source.content, (line) => /\b(risk|blocker|assumption|dependency|warning)\b/i.test(line)),
    ...(input.workspaceSummary?.warnings ?? [])
  ]).slice(0, 6);

  const repoHints = {
    matchedFiles: input.workspaceSummary?.matchedFiles ?? [],
    suggestedQueries: uniqueStrings([
      metadata.title ?? '',
      ...metadata.tags.map((tag) => `#${tag}`),
      ...extractKeywords(source.content)
    ]).slice(0, 6)
  };

  return {
    brief,
    objective: input.objective,
    source: input.path,
    relatedNotes: related.relatedNotes,
    keyFacts,
    openQuestions,
    risks,
    repoHints,
    packet: {
      source: input.path,
      objective: input.objective,
      summary: brief,
      facts: keyFacts,
      questions: openQuestions,
      risks,
      relatedNotes: related.relatedNotes.map((note) => ({
        path: note.path,
        relationship: note.relationship,
        score: note.score
      })),
      retrieval: retrieval?.results ?? [],
      repoHints
    }
  };
}

async function fallbackSnippet(reader: VaultReader, notePath: string, maxTotalBytes: number): Promise<string> {
  const read = await reader.readNote({ path: notePath, maxBytes: maxTotalBytes });
  return read.content.replace(/^---[\s\S]*?^---\s*/m, '').slice(0, 280).trim();
}

function firstSentence(content: string): string {
  const normalized = content.replace(/^---[\s\S]*?^---\s*/m, '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const sentence = normalized.match(/.*?[.!?](?:\s|$)/)?.[0] ?? normalized.slice(0, 180);
  return sentence.trim();
}

function extractLines(content: string, predicate: (line: string) => boolean): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(predicate);
}

function extractKeywords(content: string): string[] {
  return uniqueStrings(
    content
      .toLowerCase()
      .replace(/[^a-z0-9_\-\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 5)
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeWeights(weights: { lexical: number; graph: number; embedding: number }) {
  const total = weights.lexical + weights.graph + weights.embedding;
  if (total <= 0) {
    return { lexical: 0, graph: 0, embedding: 0 };
  }

  return {
    lexical: weights.lexical / total,
    graph: weights.graph / total,
    embedding: weights.embedding / total
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const floored = Math.floor(value);
  return Math.min(Math.max(floored, min), max);
}
