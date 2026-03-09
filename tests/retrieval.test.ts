import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextEngine } from '../src/context.js';
import type { EmbeddingProvider } from '../src/embedding-provider.js';
import { EmbeddingStore } from '../src/embedding-store.js';
import { KnowledgeGraph } from '../src/graph.js';
import { RetrievalService } from '../src/retrieval.js';
import { VaultReader } from '../src/vault.js';

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model = 'fake-embedding';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => [
      (text.match(/alpha/gi) ?? []).length + 1,
      (text.match(/beta/gi) ?? []).length + 1,
      text.length
    ]);
  }
}

let tempDir = '';
let vaultDir = '';
let sqlitePath = '';

async function write(relPath: string, content: string) {
  const target = path.join(vaultDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

describe('RetrievalService', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retrieval-test-'));
    vaultDir = path.join(tempDir, 'vault');
    sqlitePath = path.join(tempDir, 'index.sqlite');
    await fs.mkdir(vaultDir, { recursive: true });
    await write('hub.md', '# Hub\nAlpha planning note linking [[child]]. #plan');
    await write('child.md', '# Child\nBeta implementation detail alpha alpha.');
    await write('other.md', '# Other\nCompletely separate note.');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to graph retrieval when embeddings are disabled', async () => {
    const reader = await VaultReader.create(vaultDir, 1024 * 1024);
    const graph = new KnowledgeGraph(vaultDir, 1024 * 1024);
    await graph.build();
    const contextEngine = new ContextEngine(graph, vaultDir, 1024 * 1024);
    const service = new RetrievalService({
      reader,
      graph,
      contextEngine,
      embeddingConfig: {
        enabled: false,
        provider: 'openai',
        model: 'unused',
        sqlitePath,
        apiKey: undefined
      },
      createProvider: () => new FakeEmbeddingProvider()
    });

    const result = await service.retrieve({ query: 'alpha', path: 'hub.md', maxResults: 5 });

    expect(result.retrievalMode).toBe('graph');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('uses hybrid retrieval when embeddings are indexed', async () => {
    const reader = await VaultReader.create(vaultDir, 1024 * 1024);
    const graph = new KnowledgeGraph(vaultDir, 1024 * 1024);
    await graph.build();
    const contextEngine = new ContextEngine(graph, vaultDir, 1024 * 1024);
    const provider = new FakeEmbeddingProvider();
    const store = await EmbeddingStore.open(sqlitePath);
    await store.indexVault(reader, provider, {});

    const service = new RetrievalService({
      reader,
      graph,
      contextEngine,
      embeddingConfig: {
        enabled: true,
        provider: 'openai',
        model: provider.model,
        sqlitePath,
        apiKey: 'test-key'
      },
      createProvider: () => provider
    });

    const first = await service.retrieve({ query: 'alpha', path: 'hub.md', maxResults: 5, useEmbeddings: true });
    const second = await service.retrieve({ query: 'alpha', path: 'hub.md', maxResults: 5, useEmbeddings: true });

    expect(first.retrievalMode).toBe('hybrid');
    expect(first.results[0]?.scores.embedding).toBeGreaterThan(0);
    expect(first.results.map((entry) => entry.path)).toEqual(second.results.map((entry) => entry.path));
  });
});

