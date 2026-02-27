import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { VaultError } from './errors.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  path: string;
  title?: string;
  tags: string[];
  outLinks: string[];
  backLinks: string[];
}

export interface GraphStats {
  [key: string]: unknown;
  nodes: number;
  edges: number;
  tags: number;
  buildTimeMs: number;
}

export interface NeighborEntry {
  path: string;
  title?: string;
  relationship: 'outLink' | 'backLink' | 'sharedTag';
  depth: number;
}

/* ------------------------------------------------------------------ */
/*  Parsing helpers                                                    */
/* ------------------------------------------------------------------ */

/** Match `[[target]]` and `[[target|alias]]`, ignoring code blocks. */
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;

/** Match inline `#tag` outside of frontmatter and code blocks. */
const INLINE_TAG_RE = /(?:^|\s)#([A-Za-z][\w/-]*)/g;

/** Strip frontmatter + fenced code blocks before parsing inline elements. */
function stripFencedBlocks(content: string): string {
  // Remove fenced code blocks (``` ... ```)
  return content.replace(/^```[\s\S]*?^```/gm, '');
}

function parseWikilinks(content: string): string[] {
  const body = stripFencedBlocks(content);
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    const target = match[1].trim();
    if (target.length > 0) {
      links.push(target);
    }
  }
  return [...new Set(links)].sort();
}

function parseInlineTags(content: string): string[] {
  // Strip frontmatter first
  const withoutFm = content.replace(/^---[\s\S]*?^---/m, '');
  const body = stripFencedBlocks(withoutFm);
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(body)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

function extractHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function normalizeFrontmatterTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((e) => (typeof e === 'string' ? e.trim() : ''))
      .filter((e) => e.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }
  return [];
}

/**
 * Resolve a wikilink target to an actual vault-relative path.
 * Supports exact paths (folder/note) and bare names (note → note.md).
 */
function resolveWikilinkTarget(target: string, allPaths: string[]): string | null {
  // 1. Exact match
  if (allPaths.includes(target)) return target;

  // 2. Append .md
  const withMd = target.endsWith('.md') ? target : `${target}.md`;
  if (allPaths.includes(withMd)) return withMd;

  // 3. Basename match — shortest path wins (Obsidian default)
  const baseName = path.basename(withMd);
  const candidates = allPaths.filter((p) => path.basename(p) === baseName);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // deterministic: pick lexicographically first
    return candidates.sort()[0];
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  KnowledgeGraph                                                     */
/* ------------------------------------------------------------------ */

export class KnowledgeGraph {
  private readonly rootPath: string;
  private readonly maxFileBytes: number;
  private nodes = new Map<string, GraphNode>();
  private allTags = new Set<string>();
  private built = false;

  constructor(rootPath: string, maxFileBytes: number) {
    this.rootPath = rootPath;
    this.maxFileBytes = maxFileBytes;
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /* ---------- build ------------------------------------------------ */

  async build(): Promise<GraphStats> {
    const start = Date.now();
    this.nodes.clear();
    this.allTags.clear();

    // 1. Discover all markdown files
    const entries = await fg(['**/*.md'], {
      cwd: this.rootPath,
      onlyFiles: true,
      absolute: false,
      dot: false,
      followSymbolicLinks: false,
      unique: true,
      suppressErrors: false
    });

    const sortedPaths = entries.map(toPosixPath).sort();

    // 2. First pass — parse every note
    const rawNodes: Map<string, { title?: string; tags: string[]; rawLinks: string[] }> = new Map();

    for (const notePath of sortedPaths) {
      const absolute = path.resolve(this.rootPath, notePath);
      let stats;
      try {
        stats = await fs.stat(absolute);
      } catch {
        continue;
      }
      if (stats.size > this.maxFileBytes) continue;

      const text = await fs.readFile(absolute, 'utf8');
      const parsed = matter(text);

      const fmTags = normalizeFrontmatterTags(parsed.data?.tags);
      const inlineTags = parseInlineTags(text);
      const mergedTags = [...new Set([...fmTags, ...inlineTags])].sort();

      const titleFromFm = typeof parsed.data?.title === 'string' ? parsed.data.title : undefined;
      const titleFromHeading = extractHeading(text);

      const rawLinks = parseWikilinks(text);

      rawNodes.set(notePath, {
        title: titleFromFm ?? titleFromHeading,
        tags: mergedTags,
        rawLinks
      });
    }

    // 3. Second pass — resolve links + build backlink index
    for (const [notePath, raw] of rawNodes) {
      const resolvedLinks: string[] = [];
      for (const target of raw.rawLinks) {
        const resolved = resolveWikilinkTarget(target, sortedPaths);
        if (resolved && resolved !== notePath) {
          resolvedLinks.push(resolved);
        }
      }

      const node: GraphNode = {
        path: notePath,
        title: raw.title,
        tags: raw.tags,
        outLinks: [...new Set(resolvedLinks)].sort(),
        backLinks: [] // filled below
      };

      for (const tag of raw.tags) {
        this.allTags.add(tag);
      }

      this.nodes.set(notePath, node);
    }

    // 4. Build backlinks
    for (const [sourcePath, node] of this.nodes) {
      for (const targetPath of node.outLinks) {
        const targetNode = this.nodes.get(targetPath);
        if (targetNode && !targetNode.backLinks.includes(sourcePath)) {
          targetNode.backLinks.push(sourcePath);
        }
      }
    }

    // Sort backlinks for determinism
    for (const node of this.nodes.values()) {
      node.backLinks.sort();
    }

    // Count edges
    let edgeCount = 0;
    for (const node of this.nodes.values()) {
      edgeCount += node.outLinks.length;
    }

    this.built = true;

    return {
      nodes: this.nodes.size,
      edges: edgeCount,
      tags: this.allTags.size,
      buildTimeMs: Date.now() - start
    };
  }

  /* ---------- queries ---------------------------------------------- */

  getNode(notePath: string): GraphNode {
    this.ensureBuilt();
    const node = this.nodes.get(notePath);
    if (!node) {
      throw new VaultError('E_NODE_NOT_FOUND', `Node not found in graph: ${notePath}`);
    }
    return node;
  }

  getNeighbors(notePath: string, maxDepth = 1): NeighborEntry[] {
    this.ensureBuilt();
    const source = this.getNode(notePath);

    const visited = new Set<string>([notePath]);
    const result: NeighborEntry[] = [];

    interface QueueItem {
      path: string;
      depth: number;
      relationship: 'outLink' | 'backLink';
    }

    const queue: QueueItem[] = [];

    // Seed with depth-1 neighbors
    for (const link of source.outLinks) {
      queue.push({ path: link, depth: 1, relationship: 'outLink' });
    }
    for (const link of source.backLinks) {
      queue.push({ path: link, depth: 1, relationship: 'backLink' });
    }

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.path)) continue;
      if (item.depth > maxDepth) continue;

      visited.add(item.path);

      const node = this.nodes.get(item.path);
      if (!node) continue;

      result.push({
        path: node.path,
        title: node.title,
        relationship: item.relationship,
        depth: item.depth
      });

      // BFS expansion
      if (item.depth < maxDepth) {
        for (const link of node.outLinks) {
          if (!visited.has(link)) {
            queue.push({ path: link, depth: item.depth + 1, relationship: 'outLink' });
          }
        }
        for (const link of node.backLinks) {
          if (!visited.has(link)) {
            queue.push({ path: link, depth: item.depth + 1, relationship: 'backLink' });
          }
        }
      }
    }

    // Also add shared-tag neighbors (always depth 1)
    const sharedTagNodes = this.findSharedTagNodes(notePath);
    for (const stn of sharedTagNodes) {
      if (!visited.has(stn)) {
        visited.add(stn);
        const node = this.nodes.get(stn);
        if (node) {
          result.push({
            path: node.path,
            title: node.title,
            relationship: 'sharedTag',
            depth: 1
          });
        }
      }
    }

    return result.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path);
    });
  }

  getBacklinks(notePath: string): { path: string; title?: string }[] {
    this.ensureBuilt();
    const node = this.getNode(notePath);
    return node.backLinks.map((blPath) => {
      const blNode = this.nodes.get(blPath);
      return { path: blPath, title: blNode?.title };
    });
  }

  getSharedTagNodes(notePath: string): { path: string; title?: string; sharedTags: string[] }[] {
    this.ensureBuilt();
    const source = this.getNode(notePath);
    if (source.tags.length === 0) return [];

    const result: { path: string; title?: string; sharedTags: string[] }[] = [];

    for (const [otherPath, otherNode] of this.nodes) {
      if (otherPath === notePath) continue;
      const shared = source.tags.filter((t) => otherNode.tags.includes(t));
      if (shared.length > 0) {
        result.push({
          path: otherNode.path,
          title: otherNode.title,
          sharedTags: shared.sort()
        });
      }
    }

    return result.sort((a, b) => {
      if (b.sharedTags.length !== a.sharedTags.length) {
        return b.sharedTags.length - a.sharedTags.length;
      }
      return a.path.localeCompare(b.path);
    });
  }

  /* ---------- internal --------------------------------------------- */

  private findSharedTagNodes(notePath: string): string[] {
    const source = this.nodes.get(notePath);
    if (!source || source.tags.length === 0) return [];

    const result: string[] = [];
    for (const [otherPath, otherNode] of this.nodes) {
      if (otherPath === notePath) continue;
      if (source.tags.some((t) => otherNode.tags.includes(t))) {
        result.push(otherPath);
      }
    }
    return result.sort();
  }

  private ensureBuilt(): void {
    if (!this.built) {
      throw new VaultError('E_GRAPH_NOT_BUILT', 'Knowledge graph has not been built yet. Call graph.build first.');
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
