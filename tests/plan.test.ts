import { describe, expect, it } from 'vitest';
import type { PlanningProvider } from '../src/embedding-provider.js';
import { buildDeterministicPlan, PlanService } from '../src/plan.js';

class FakePlanningProvider implements PlanningProvider {
  readonly name = 'openai';
  readonly model = 'fake-plan';

  async generatePlan() {
    return {
      summary: 'LLM summary',
      goals: ['Ship feature'],
      constraints: ['No writes'],
      decisions: ['Use preview mode'],
      openQuestions: ['Which repo?'],
      suggestedActions: ['Review README'],
      handoffPrompt: 'Prompt'
    };
  }
}

describe('PlanService', () => {
  it('builds deterministic preview plans', () => {
    const result = buildDeterministicPlan({
      path: 'note.md',
      objective: 'Implement the feature',
      style: 'implementation',
      content: '# Title\nImplement the feature.\nMust stay read-only.\nWhat about auth?\n',
      title: 'Title',
      relatedContext: []
    });

    expect(result.generationMode).toBe('deterministic');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.constraints.some((entry) => entry.includes('read-only'))).toBe(true);
  });

  it('uses provider output when planning is enabled', async () => {
    const service = new PlanService({
      reader: {
        readNote: async () => ({
          path: 'note.md',
          content: '# Title\nImplement the feature.',
          bytes: 20,
          sha256: 'a'.repeat(64),
          lineCount: 2
        }),
        getMetadata: async () => ({
          path: 'note.md',
          title: 'Title',
          tags: [],
          frontmatter: {}
        })
      } as any,
      planningConfig: {
        enabled: true,
        provider: 'openai',
        model: 'fake-plan',
        apiKey: 'test-key'
      },
      createProvider: () => new FakePlanningProvider(),
      retrievalService: {
        retrieve: async () => ({
          query: 'Implement the feature',
          sourcePath: 'note.md',
          retrievalMode: 'graph' as const,
          results: [],
          total: 0
        })
      } as any
    });

    const result = await service.planFromNote({
      path: 'note.md',
      objective: 'Implement the feature',
      useModel: true
    });

    expect(result.generationMode).toBe('llm');
    expect(result.summary).toBe('LLM summary');
  });
});

