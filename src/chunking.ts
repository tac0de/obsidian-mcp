export interface MarkdownChunk {
  chunkId: string;
  ordinal: number;
  text: string;
  textLength: number;
}

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?^---\s*/m, '');
}

export function chunkMarkdown(
  notePath: string,
  content: string,
  options: ChunkingOptions = {}
): MarkdownChunk[] {
  const chunkSize = clampInt(options.chunkSize, DEFAULT_CHUNK_SIZE, 20, 4_000);
  const chunkOverlap = clampInt(options.chunkOverlap, DEFAULT_CHUNK_OVERLAP, 0, Math.floor(chunkSize / 2));
  const normalized = normalizeMarkdown(stripFrontmatter(content));
  if (!normalized) {
    return [];
  }

  const chunks: MarkdownChunk[] = [];
  let ordinal = 0;
  let cursor = 0;

  while (cursor < normalized.length) {
    const maxEnd = Math.min(cursor + chunkSize, normalized.length);
    let end = maxEnd;

    if (maxEnd < normalized.length) {
      const boundary = findBoundary(normalized, cursor, maxEnd);
      if (boundary > cursor) {
        end = boundary;
      }
    }

    const text = normalized.slice(cursor, end).trim();
    if (text.length > 0) {
      chunks.push({
        chunkId: `${notePath}#${ordinal}`,
        ordinal,
        text,
        textLength: estimateTokenishLength(text)
      });
      ordinal += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    cursor = Math.max(end - chunkOverlap, cursor + 1);
  }

  return chunks;
}

export function estimateTokenishLength(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeMarkdown(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findBoundary(content: string, start: number, maxEnd: number): number {
  const candidate = content.slice(start, maxEnd);
  const doubleNewline = candidate.lastIndexOf('\n\n');
  if (doubleNewline >= 0) {
    return start + doubleNewline;
  }

  const sentenceBreak = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('\n'));
  if (sentenceBreak >= 0) {
    return start + sentenceBreak + 1;
  }

  const whitespace = candidate.lastIndexOf(' ');
  if (whitespace >= 0) {
    return start + whitespace;
  }

  return maxEnd;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const floored = Math.floor(value);
  return Math.min(Math.max(floored, min), max);
}
