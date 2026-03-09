import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { VaultError } from '../src/errors.js';
import { VaultReader } from '../src/vault.js';

let rootDir = '';

async function write(relPath: string, content: string) {
  const target = path.join(rootDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

describe('VaultReader', () => {
  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-to-action-mcp-test-'));
    await write('b.md', '# Bravo\nfoo\nbar\nfoo');
    await write('a.md', '# Alpha\nfoo');
    await write('nested/c.md', '---\ntitle: Custom\ntags:\n  - governance\n  - mcp\n---\n# Heading\ncontent');
  });

  afterEach(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('returns deterministic sorted notes', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);
    const first = await reader.listNotes({ glob: '**/*.md' });
    const second = await reader.listNotes({ glob: '**/*.md' });

    expect(first).toEqual(second);
    expect(first.notes).toEqual(['a.md', 'b.md', 'nested/c.md']);
    expect(first.total).toBe(3);
  });

  it('reads note with stable hash and counts lines', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);
    const note = await reader.readNote({ path: 'a.md' });

    expect(note.path).toBe('a.md');
    expect(note.lineCount).toBe(2);
    expect(note.sha256).toBe(createHash('sha256').update(Buffer.from('# Alpha\nfoo')).digest('hex'));
  });

  it('blocks path traversal with fixed error code', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);

    await expect(reader.readNote({ path: '../secret.md' })).rejects.toMatchObject({
      code: 'E_PATH_TRAVERSAL'
    } satisfies Partial<VaultError>);
  });

  it('rejects empty query with fixed error code', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);

    await expect(reader.searchNotes({ query: '   ' })).rejects.toMatchObject({
      code: 'E_EMPTY_QUERY'
    } satisfies Partial<VaultError>);
  });

  it('returns deterministic search ordering', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);
    const result = await reader.searchNotes({ query: 'foo' });

    expect(result.total).toBe(3);
    expect(result.matches.map((m) => `${m.path}:${m.lineNumber}`)).toEqual(['a.md:2', 'b.md:2', 'b.md:4']);
  });

  it('rejects oversized read requests', async () => {
    const reader = await VaultReader.create(rootDir, 2);

    await expect(reader.readNote({ path: 'a.md' })).rejects.toMatchObject({
      code: 'E_MAX_BYTES_EXCEEDED'
    } satisfies Partial<VaultError>);
  });

  it('extracts metadata deterministically', async () => {
    const reader = await VaultReader.create(rootDir, 1024 * 1024);
    const metadata = await reader.getMetadata({ path: 'nested/c.md' });

    expect(metadata.path).toBe('nested/c.md');
    expect(metadata.title).toBe('Custom');
    expect(metadata.tags).toEqual(['governance', 'mcp']);
    expect(Object.keys(metadata.frontmatter)).toEqual(['tags', 'title']);
  });
});
