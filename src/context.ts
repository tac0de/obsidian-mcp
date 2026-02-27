import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KnowledgeGraph } from './graph.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RelatedNote {
    path: string;
    title?: string;
    score: number;
    relationship: string;
    snippet: string;
}

export interface ContextResult {
    [key: string]: unknown;
    source: string;
    relatedNotes: RelatedNote[];
    totalNodes: number;
    graphDepth: number;
}

/* ------------------------------------------------------------------ */
/*  Scoring weights                                                    */
/* ------------------------------------------------------------------ */

const SCORE_DIRECT_LINK = 1.0;
const SCORE_BACKLINK = 1.0;
const SCORE_SHARED_TAG = 0.5;
const SCORE_TWO_HOP = 0.3;

/* ------------------------------------------------------------------ */
/*  ContextEngine                                                      */
/* ------------------------------------------------------------------ */

export class ContextEngine {
    private readonly graph: KnowledgeGraph;
    private readonly rootPath: string;
    private readonly maxFileBytes: number;

    constructor(graph: KnowledgeGraph, rootPath: string, maxFileBytes: number) {
        this.graph = graph;
        this.rootPath = rootPath;
        this.maxFileBytes = maxFileBytes;
    }

    async gatherContext(
        notePath: string,
        maxNotes = 10,
        maxTotalBytes = 50_000
    ): Promise<ContextResult> {
        // Ensure node exists (will throw E_NODE_NOT_FOUND if not)
        const sourceNode = this.graph.getNode(notePath);

        // Collect scored candidates
        const scoreMap = new Map<string, { score: number; relationship: string }>();

        function addScore(p: string, delta: number, rel: string) {
            const existing = scoreMap.get(p);
            if (existing) {
                if (existing.score < delta) {
                    scoreMap.set(p, { score: delta, relationship: rel });
                } else {
                    // boost slightly for multiple relationships
                    scoreMap.set(p, { score: existing.score + delta * 0.1, relationship: existing.relationship });
                }
            } else {
                scoreMap.set(p, { score: delta, relationship: rel });
            }
        }

        // 1. Direct outLinks → score 1.0
        for (const link of sourceNode.outLinks) {
            addScore(link, SCORE_DIRECT_LINK, 'outLink');
        }

        // 2. Backlinks → score 1.0
        for (const link of sourceNode.backLinks) {
            addScore(link, SCORE_BACKLINK, 'backLink');
        }

        // 3. Shared tags → 0.5 per shared tag
        const sharedTagNodes = this.graph.getSharedTagNodes(notePath);
        for (const stn of sharedTagNodes) {
            const tagScore = SCORE_SHARED_TAG * stn.sharedTags.length;
            addScore(stn.path, tagScore, `sharedTag(${stn.sharedTags.join(',')})`);
        }

        // 4. 2-hop links → score 0.3
        const neighbors = this.graph.getNeighbors(notePath, 2);
        for (const n of neighbors) {
            if (n.depth === 2) {
                addScore(n.path, SCORE_TWO_HOP, '2-hop');
            }
        }

        // Remove self
        scoreMap.delete(notePath);

        // Sort by score descending, then path ascending for determinism
        const ranked = [...scoreMap.entries()]
            .sort((a, b) => {
                if (b[1].score !== a[1].score) return b[1].score - a[1].score;
                return a[0].localeCompare(b[0]);
            })
            .slice(0, maxNotes);

        // Gather snippets within byte budget
        const relatedNotes: RelatedNote[] = [];
        let totalBytes = 0;

        for (const [candidatePath, meta] of ranked) {
            if (totalBytes >= maxTotalBytes) break;

            const absolute = path.resolve(this.rootPath, candidatePath);
            let text: string;
            try {
                const stats = await fs.stat(absolute);
                if (stats.size > this.maxFileBytes) continue;
                text = await fs.readFile(absolute, 'utf8');
            } catch {
                continue;
            }

            // Create snippet: first 500 chars of body (after frontmatter)
            const body = text.replace(/^---[\s\S]*?^---\s*/m, '');
            const remainingBudget = maxTotalBytes - totalBytes;
            const snippetLength = Math.min(500, remainingBudget);
            const snippet = body.slice(0, snippetLength).trimEnd();

            const node = this.graph.getNode(candidatePath);

            relatedNotes.push({
                path: candidatePath,
                title: node.title,
                score: Math.round(meta.score * 100) / 100,
                relationship: meta.relationship,
                snippet
            });

            totalBytes += Buffer.byteLength(snippet, 'utf8');
        }

        return {
            source: notePath,
            relatedNotes,
            totalNodes: scoreMap.size + 1, // include self
            graphDepth: 2
        };
    }
}
