import type { PlanningConfig } from './embedding-config.js';
import type { PlanOutput, PlanningProvider } from './embedding-provider.js';
import type { RetrievalService } from './retrieval.js';
import type { VaultReader } from './vault.js';

export type PlanStyle = 'implementation' | 'research' | 'content' | 'ops';

export interface DeterministicPlanResult extends PlanOutput {
  generationMode: 'deterministic' | 'llm';
}

export class PlanService {
  private readonly reader: VaultReader;
  private readonly planningConfig: PlanningConfig;
  private readonly createProvider: () => PlanningProvider;
  private readonly retrievalService: RetrievalService;

  constructor(options: {
    reader: VaultReader;
    planningConfig: PlanningConfig;
    createProvider: () => PlanningProvider;
    retrievalService: RetrievalService;
  }) {
    this.reader = options.reader;
    this.planningConfig = options.planningConfig;
    this.createProvider = options.createProvider;
    this.retrievalService = options.retrievalService;
  }

  async planFromNote(input: {
    path: string;
    objective?: string;
    style?: PlanStyle;
    useModel?: boolean;
    maxRelatedNotes?: number;
  }): Promise<{
    source: string;
    summary: string;
    goals: string[];
    constraints: string[];
    decisions: string[];
    openQuestions: string[];
    suggestedActions: string[];
    handoffPrompt: string;
    generationMode: 'deterministic' | 'llm';
  }> {
    const style = input.style ?? 'implementation';
    const read = await this.reader.readNote({ path: input.path });
    const metadata = await this.reader.getMetadata({ path: input.path });
    const retrieval = await this.retrievalService.retrieve({
      query: input.objective || metadata.title || input.path,
      path: input.path,
      maxResults: input.maxRelatedNotes ?? 5,
      useEmbeddings: false
    });

    let result = buildDeterministicPlan({
      path: input.path,
      objective: input.objective,
      style,
      content: read.content,
      title: metadata.title,
      relatedContext: retrieval.results
    });

    const shouldUseModel = input.useModel ?? this.planningConfig.enabled;
    if (shouldUseModel && this.planningConfig.enabled && this.planningConfig.apiKey) {
      try {
        const provider = this.createProvider();
        const llmResult = await provider.generatePlan({
          path: input.path,
          objective: input.objective,
          style,
          sourceContent: read.content,
          relatedContext: retrieval.results.map((resultItem) => ({
            path: resultItem.path,
            snippet: resultItem.snippet,
            relationship: resultItem.relationship
          }))
        });

        result = {
          ...llmResult,
          generationMode: 'llm'
        };
      } catch {
        // Deterministic fallback is intentional for v2.1.
      }
    }

    return {
      source: input.path,
      ...result
    };
  }
}

export function buildDeterministicPlan(input: {
  path: string;
  objective?: string;
  style: PlanStyle;
  content: string;
  title?: string;
  relatedContext: Array<{ path: string; snippet: string; relationship: string }>;
}): DeterministicPlanResult {
  const lines = input.content
    .replace(/^---[\s\S]*?^---\s*/m, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const summary =
    lines.find((line) => !line.startsWith('#'))?.slice(0, 220) ||
    input.title ||
    input.path;

  const goals = uniqueStrings([
    ...(input.objective ? [`Objective: ${input.objective}`] : []),
    ...lines.filter((line) => /^#+\s+/.test(line)).map((line) => line.replace(/^#+\s+/, '')),
    ...lines.filter((line) => /\b(build|implement|ship|launch|create|write|research)\b/i.test(line))
  ]).slice(0, 6);

  const constraints = uniqueStrings(
    lines.filter((line) => /\b(must|should|only|limit|constraint|without|readonly|read-only)\b/i.test(line))
  ).slice(0, 6);

  const decisions = uniqueStrings([
    ...lines.filter((line) => /\b(decision|choose|selected|picked|use )\b/i.test(line)),
    ...input.relatedContext.slice(0, 2).map((item) => `Related context: ${item.path} (${item.relationship})`)
  ]).slice(0, 6);

  const openQuestions = uniqueStrings([
    ...lines.filter((line) => line.includes('?')),
    ...lines.filter((line) => /\b(todo|tbd|unknown|question)\b/i.test(line))
  ]).slice(0, 6);

  const suggestedActions = uniqueStrings([
    ...goals.map((goal) => `Clarify scope for: ${goal}`),
    ...openQuestions.map((question) => `Resolve: ${question}`),
    ...input.relatedContext.slice(0, 3).map((item) => `Review ${item.path} for supporting context`)
  ]).slice(0, 6);

  const handoffPrompt = [
    `Style: ${input.style}`,
    `Source note: ${input.path}`,
    input.objective ? `Objective: ${input.objective}` : '',
    `Summary: ${summary}`,
    goals.length > 0 ? `Goals: ${goals.join(' | ')}` : '',
    constraints.length > 0 ? `Constraints: ${constraints.join(' | ')}` : '',
    openQuestions.length > 0 ? `Open questions: ${openQuestions.join(' | ')}` : '',
    `Use preview-only planning and do not mutate files without explicit approval.`
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  return {
    summary,
    goals,
    constraints,
    decisions,
    openQuestions,
    suggestedActions,
    handoffPrompt,
    generationMode: 'deterministic'
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

