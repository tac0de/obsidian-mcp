import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../src/chunking.js';

describe('chunkMarkdown', () => {
  it('strips frontmatter before chunking', () => {
    const chunks = chunkMarkdown(
      'note.md',
      '---\ntitle: Demo\n---\n# Heading\nThis is the body.\n',
      { chunkSize: 30, chunkOverlap: 5 }
    );

    expect(chunks[0]?.text).not.toContain('title: Demo');
    expect(chunks[0]?.text).toContain('# Heading');
  });

  it('keeps overlapping content across chunks', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const chunks = chunkMarkdown('note.md', text, { chunkSize: 24, chunkOverlap: 6 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.text.slice(-6).trim().length).toBeGreaterThan(0);
    expect(chunks[1]?.text.length).toBeGreaterThan(0);
  });

  it('returns deterministic ordering', () => {
    const text = '# Title\nOne two three four five six seven eight nine ten.';
    const first = chunkMarkdown('note.md', text, { chunkSize: 20, chunkOverlap: 4 });
    const second = chunkMarkdown('note.md', text, { chunkSize: 20, chunkOverlap: 4 });

    expect(first).toEqual(second);
  });
});

