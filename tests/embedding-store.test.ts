import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingStore } from '../src/embedding-store.js';
import type { EmbeddingProvider } from '../src/embedding-provider.js';
import { VaultReader } from '../src/vault.js';

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model = 'fake-embedding';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => [text.length, (text.match(/alpha/gi) ?? []).length, (text.match(/beta/gi) ?? []).length]);
  }
}

let tempDir = '';
let vaultDir = '';
let dbPath = '';

async function write(relPath: string, content: string) {
  const target = path.join(vaultDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

describe('EmbeddingStore', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'embedding-store-test-'));
    vaultDir = path.join(tempDir, 'vault');
    dbPath = path.join(tempDir, 'index.sqlite');
    await fs.mkdir(vaultDir, { recursive: true });
    await write('a.md', '# Alpha\nalpha beta gamma');
    await write('b.md', '# Bravo\nbeta only');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('indexes notes and skips unchanged files', async () => {
    const reader = await VaultReader.create(vaultDir, 1024 * 1024);
    const provider = new FakeEmbeddingProvider();
    const store = await EmbeddingStore.open(dbPath);

    const first = await store.indexVault(reader, provider, { chunkSize: 20, chunkOverlap: 5 });
    const second = await store.indexVault(reader, provider, { chunkSize: 20, chunkOverlap: 5 });

    expect(first.notesIndexed).toBe(2);
    expect(first.chunksIndexed).toBeGreaterThan(0);
    expect(second.notesIndexed).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('reindexes only changed notes', async () => {
    const reader = await VaultReader.create(vaultDir, 1024 * 1024);
    const provider = new FakeEmbeddingProvider();
    const store = await EmbeddingStore.open(dbPath);

    await store.indexVault(reader, provider, { chunkSize: 20, chunkOverlap: 5 });
    await write('a.md', '# Alpha\nalpha beta gamma delta');

    const result = await store.indexVault(reader, provider, { chunkSize: 20, chunkOverlap: 5 });

    expect(result.notesIndexed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(store.countEmbeddings()).toBeGreaterThan(0);
  });
});

