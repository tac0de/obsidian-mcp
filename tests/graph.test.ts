import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { VaultError } from '../src/errors.js';
import { KnowledgeGraph } from '../src/graph.js';

let rootDir = '';

async function write(relPath: string, content: string) {
    const target = path.join(rootDir, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
}

describe('KnowledgeGraph', () => {
    beforeEach(async () => {
        rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'));

        // a.md links to b.md and c.md
        await write(
            'a.md',
            '---\ntags:\n  - project\n---\n# Alpha\nSee [[b]] and [[c|Charlie]].\n'
        );

        // b.md links to a.md, has inline tag
        await write('b.md', '# Bravo\nBack to [[a]]. #project #review\n');

        // c.md has no links, shares tag
        await write(
            'nested/c.md',
            '---\ntags:\n  - governance\n  - project\n---\n# Charlie\nStandalone note.\n'
        );

        // d.md is isolated (no links, no shared tags)
        await write('d.md', '# Delta\nNo connections here.\n');
    });

    afterEach(async () => {
        if (rootDir) {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('builds graph with correct node count', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        const stats = await graph.build();

        expect(stats.nodes).toBe(4);
        expect(stats.edges).toBeGreaterThan(0);
        expect(stats.tags).toBeGreaterThan(0);
        expect(stats.buildTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('parses [[wikilink]] and [[wikilink|alias]] correctly', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        const nodeA = graph.getNode('a.md');
        expect(nodeA.outLinks).toContain('b.md');
        expect(nodeA.outLinks).toContain('nested/c.md');
    });

    it('computes backlinks correctly', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        const nodeB = graph.getNode('b.md');
        expect(nodeB.backLinks).toContain('a.md');

        const nodeA = graph.getNode('a.md');
        expect(nodeA.backLinks).toContain('b.md');
    });

    it('merges frontmatter and inline tags', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        // b.md has inline #project and #review
        const nodeB = graph.getNode('b.md');
        expect(nodeB.tags).toContain('project');
        expect(nodeB.tags).toContain('review');

        // a.md has frontmatter tag project
        const nodeA = graph.getNode('a.md');
        expect(nodeA.tags).toContain('project');
    });

    it('returns deterministically sorted neighbors', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        const neighbors = graph.getNeighbors('a.md', 1);
        const paths = neighbors.map((n) => n.path);

        // Should be sorted: depth first, then path alphabetically
        const sorted = [...paths].sort();
        // All depth-1, so just path sort
        const depth1 = neighbors.filter((n) => n.depth === 1).map((n) => n.path);
        expect(depth1).toEqual([...depth1].sort());
    });

    it('supports multi-depth BFS traversal', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        // From d.md (isolated), expect no neighbors
        const noNeighbors = graph.getNeighbors('d.md', 2);
        expect(noNeighbors.length).toBe(0);

        // From a.md at depth 2, should find indirect connections
        const deep = graph.getNeighbors('a.md', 2);
        expect(deep.length).toBeGreaterThan(0);
    });

    it('throws E_NODE_NOT_FOUND for missing node', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        expect(() => graph.getNode('nonexistent.md')).toThrow();
        try {
            graph.getNode('nonexistent.md');
        } catch (e) {
            expect(e).toBeInstanceOf(VaultError);
            expect((e as VaultError).code).toBe('E_NODE_NOT_FOUND');
        }
    });

    it('throws E_GRAPH_NOT_BUILT before build()', () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);

        expect(() => graph.getNode('a.md')).toThrow();
        try {
            graph.getNode('a.md');
        } catch (e) {
            expect(e).toBeInstanceOf(VaultError);
            expect((e as VaultError).code).toBe('E_GRAPH_NOT_BUILT');
        }
    });

    it('finds shared tag nodes', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        const shared = graph.getSharedTagNodes('a.md');
        const paths = shared.map((s) => s.path);

        // a.md has tag "project"; b.md and nested/c.md also have "project"
        expect(paths).toContain('b.md');
        expect(paths).toContain('nested/c.md');

        // d.md has no tags → should not appear
        expect(paths).not.toContain('d.md');
    });

    it('returns backlinks list', async () => {
        const graph = new KnowledgeGraph(rootDir, 1024 * 1024);
        await graph.build();

        const backlinks = graph.getBacklinks('b.md');
        expect(backlinks.map((b) => b.path)).toContain('a.md');
    });
});
