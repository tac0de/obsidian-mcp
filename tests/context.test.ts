import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { KnowledgeGraph } from '../src/graph.js';
import { ContextEngine } from '../src/context.js';

let rootDir = '';

async function write(relPath: string, content: string) {
    const target = path.join(rootDir, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
}

describe('ContextEngine', () => {
    beforeEach(async () => {
        rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-test-'));

        await write(
            'hub.md',
            '---\ntags:\n  - core\n---\n# Hub Note\nThis links to [[spoke1]] and [[spoke2]].\nLots of content here.\n'
        );

        await write(
            'spoke1.md',
            '---\ntags:\n  - core\n  - feature\n---\n# Spoke 1\nLinked from hub. Also see [[spoke3]].\n'
        );

        await write(
            'spoke2.md',
            '# Spoke 2\nLinked from hub. #core\n'
        );

        await write(
            'spoke3.md',
            '# Spoke 3\nOnly linked from spoke1. #feature\n'
        );

        await write(
            'isolated.md',
            '# Isolated\nNo links, no shared tags with hub.\n'
        );
    });

    afterEach(async () => {
        if (rootDir) {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('scores direct links higher than 2-hop', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        const result = await engine.gatherContext('hub.md');

        expect(result.source).toBe('hub.md');
        expect(result.relatedNotes.length).toBeGreaterThan(0);

        // spoke1 and spoke2 are direct links → should have higher score
        const spoke1 = result.relatedNotes.find((n) => n.path === 'spoke1.md');
        const spoke3 = result.relatedNotes.find((n) => n.path === 'spoke3.md');

        expect(spoke1).toBeDefined();
        if (spoke1 && spoke3) {
            expect(spoke1.score).toBeGreaterThan(spoke3.score);
        }
    });

    it('includes snippets in results', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        const result = await engine.gatherContext('hub.md');

        for (const note of result.relatedNotes) {
            expect(typeof note.snippet).toBe('string');
            expect(note.snippet.length).toBeGreaterThan(0);
        }
    });

    it('respects maxNotes limit', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        const result = await engine.gatherContext('hub.md', 1);

        expect(result.relatedNotes.length).toBeLessThanOrEqual(1);
    });

    it('respects maxTotalBytes limit', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        // Very small byte limit
        const result = await engine.gatherContext('hub.md', 50, 1000);

        let totalSnippetBytes = 0;
        for (const note of result.relatedNotes) {
            totalSnippetBytes += Buffer.byteLength(note.snippet, 'utf8');
        }

        expect(totalSnippetBytes).toBeLessThanOrEqual(1000);
    });

    it('returns empty related notes for isolated node', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        const result = await engine.gatherContext('isolated.md');

        expect(result.relatedNotes.length).toBe(0);
    });

    it('returns deterministic ordering', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();
        const engine = new ContextEngine(graph, rootDir, 1024 * 1024);

        const result1 = await engine.gatherContext('hub.md');
        const result2 = await engine.gatherContext('hub.md');

        expect(result1.relatedNotes.map((n) => n.path)).toEqual(
            result2.relatedNotes.map((n) => n.path)
        );
        expect(result1.relatedNotes.map((n) => n.score)).toEqual(
            result2.relatedNotes.map((n) => n.score)
        );
    });
});
