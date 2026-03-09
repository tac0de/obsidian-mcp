import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { chunkMarkdown, type MarkdownChunk } from './chunking.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import type { VaultReader } from './vault.js';

export interface EmbeddingIndexOptions {
  glob?: string;
  maxNotes?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  forceReindex?: boolean;
}

export interface EmbeddingIndexResult {
  [key: string]: unknown;
  notesIndexed: number;
  chunksIndexed: number;
  skipped: number;
  provider: string;
  durationMs: number;
}

export interface SimilarChunk {
  chunkId: string;
  notePath: string;
  ordinal: number;
  text: string;
  similarity: number;
}

interface NoteRecord {
  path: string;
  sha256: string;
  mtime: number;
  title?: string;
}

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export class EmbeddingStore {
  private readonly dbPath: string;
  private readonly db: Database;
  private readonly SQL: SqlJsStatic;

  private constructor(dbPath: string, db: Database, SQL: SqlJsStatic) {
    this.dbPath = dbPath;
    this.db = db;
    this.SQL = SQL;
    this.ensureSchema();
  }

  static async open(dbPath: string): Promise<EmbeddingStore> {
    const SQL = await getSqlJs();
    let db: Database;

    try {
      const existing = await fs.readFile(dbPath);
      db = new SQL.Database(existing);
    } catch {
      db = new SQL.Database();
    }

    return new EmbeddingStore(dbPath, db, SQL);
  }

  async indexVault(
    reader: VaultReader,
    provider: EmbeddingProvider,
    options: EmbeddingIndexOptions = {}
  ): Promise<EmbeddingIndexResult> {
    const start = Date.now();
    const maxNotes = typeof options.maxNotes === 'number' ? options.maxNotes : 5_000;
    const listed = await reader.listNotes({ glob: options.glob ?? '**/*.md', limit: maxNotes });
    let notesIndexed = 0;
    let chunksIndexed = 0;
    let skipped = 0;

    for (const notePath of listed.notes) {
      const read = await reader.readNote({ path: notePath });
      const absolute = path.resolve(reader.rootPath, notePath);
      const stat = await fs.stat(absolute);
      const title = (await reader.getMetadata({ path: notePath })).title;
      const mtime = Math.floor(stat.mtimeMs);
      const existing = this.getNoteRecord(notePath);

      if (!options.forceReindex && existing && existing.sha256 === read.sha256 && existing.mtime === mtime) {
        skipped += 1;
        continue;
      }

      this.deleteNote(notePath);

      const chunks = chunkMarkdown(notePath, read.content, {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap
      });
      const vectors = await provider.embed(chunks.map((chunk) => chunk.text));

      this.upsertNote({
        path: notePath,
        sha256: read.sha256,
        mtime,
        title
      });

      chunks.forEach((chunk, index) => {
        this.insertChunk(chunk);
        this.insertEmbedding(chunk.chunkId, provider.name, provider.model, vectors[index] ?? []);
      });

      notesIndexed += 1;
      chunksIndexed += chunks.length;
    }

    await this.persist();

    return {
      notesIndexed,
      chunksIndexed,
      skipped,
      provider: provider.name,
      durationMs: Date.now() - start
    };
  }

  async searchSimilar(query: string, provider: EmbeddingProvider, limit = 10): Promise<SimilarChunk[]> {
    const [queryVector] = await provider.embed([query]);
    if (!queryVector || queryVector.length === 0) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT c.chunk_id, c.note_path, c.ordinal, c.text, e.vector_json
      FROM chunk_index c
      JOIN embedding_index e ON e.chunk_id = c.chunk_id
      WHERE e.provider = $provider AND e.model = $model
    `);
    stmt.bind({
      $provider: provider.name,
      $model: provider.model
    });

    const matches: SimilarChunk[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const vector = parseVector(row.vector_json);
      matches.push({
        chunkId: String(row.chunk_id),
        notePath: String(row.note_path),
        ordinal: Number(row.ordinal),
        text: String(row.text),
        similarity: cosineSimilarity(queryVector, vector)
      });
    }
    stmt.free();

    return matches
      .sort((a, b) => {
        if (b.similarity !== a.similarity) {
          return b.similarity - a.similarity;
        }
        if (a.notePath === b.notePath) {
          return a.ordinal - b.ordinal;
        }
        return a.notePath.localeCompare(b.notePath);
      })
      .slice(0, limit);
  }

  listNoteChunks(notePath: string): Array<{ chunkId: string; ordinal: number; text: string }> {
    const stmt = this.db.prepare(`
      SELECT chunk_id, ordinal, text
      FROM chunk_index
      WHERE note_path = $path
      ORDER BY ordinal ASC
    `);
    stmt.bind({ $path: notePath });

    const chunks: Array<{ chunkId: string; ordinal: number; text: string }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      chunks.push({
        chunkId: String(row.chunk_id),
        ordinal: Number(row.ordinal),
        text: String(row.text)
      });
    }
    stmt.free();
    return chunks;
  }

  countEmbeddings(): number {
    const result = this.db.exec('SELECT COUNT(*) AS total FROM embedding_index');
    return Number(result[0]?.values?.[0]?.[0] ?? 0);
  }

  async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    const bytes = this.db.export();
    await fs.writeFile(this.dbPath, Buffer.from(bytes));
  }

  private ensureSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS note_index (
        path TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        title TEXT
      );

      CREATE TABLE IF NOT EXISTS chunk_index (
        chunk_id TEXT PRIMARY KEY,
        note_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_length INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embedding_index (
        chunk_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        vector_json TEXT NOT NULL
      );
    `);
  }

  private getNoteRecord(notePath: string): NoteRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT path, sha256, mtime, title
      FROM note_index
      WHERE path = $path
      LIMIT 1
    `);
    stmt.bind({ $path: notePath });
    const found = stmt.step()
      ? (stmt.getAsObject() as Record<string, unknown>)
      : undefined;
    stmt.free();

    if (!found) {
      return undefined;
    }

    return {
      path: String(found.path),
      sha256: String(found.sha256),
      mtime: Number(found.mtime),
      title: typeof found.title === 'string' ? found.title : undefined
    };
  }

  private upsertNote(record: NoteRecord): void {
    this.db.run(
      `
        INSERT INTO note_index (path, sha256, mtime, title)
        VALUES ($path, $sha256, $mtime, $title)
        ON CONFLICT(path) DO UPDATE SET
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          title = excluded.title
      `,
      {
        $path: record.path,
        $sha256: record.sha256,
        $mtime: record.mtime,
        $title: record.title ?? null
      }
    );
  }

  private deleteNote(notePath: string): void {
    this.db.run(
      `DELETE FROM embedding_index WHERE chunk_id IN (SELECT chunk_id FROM chunk_index WHERE note_path = $path)`,
      { $path: notePath }
    );
    this.db.run(`DELETE FROM chunk_index WHERE note_path = $path`, { $path: notePath });
    this.db.run(`DELETE FROM note_index WHERE path = $path`, { $path: notePath });
  }

  private insertChunk(chunk: MarkdownChunk): void {
    this.db.run(
      `
        INSERT INTO chunk_index (chunk_id, note_path, ordinal, text, text_length)
        VALUES ($chunkId, $notePath, $ordinal, $text, $textLength)
      `,
      {
        $chunkId: chunk.chunkId,
        $notePath: chunk.chunkId.split('#')[0],
        $ordinal: chunk.ordinal,
        $text: chunk.text,
        $textLength: chunk.textLength
      }
    );
  }

  private insertEmbedding(chunkId: string, provider: string, model: string, vector: number[]): void {
    this.db.run(
      `
        INSERT INTO embedding_index (chunk_id, provider, model, vector_json)
        VALUES ($chunkId, $provider, $model, $vector)
      `,
      {
        $chunkId: chunkId,
        $provider: provider,
        $model: model,
        $vector: JSON.stringify(vector)
      }
    );
  }
}

function parseVector(value: unknown): number[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is number => typeof entry === 'number') : [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) =>
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'sql.js', 'dist', file)
    });
  }
  return sqlJsPromise;
}
