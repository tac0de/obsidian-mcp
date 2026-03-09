import { VaultError } from './errors.js';

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface PlanOutput {
  summary: string;
  goals: string[];
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
  suggestedActions: string[];
  handoffPrompt: string;
}

export interface PlanningProvider {
  readonly name: string;
  readonly model: string;
  generatePlan(input: {
    path: string;
    objective?: string;
    style: 'implementation' | 'research' | 'content' | 'ops';
    sourceContent: string;
    relatedContext: Array<{ path: string; snippet: string; relationship: string }>;
  }): Promise<PlanOutput>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { apiKey?: string; model: string; fetchFn?: typeof fetch }) {
    if (!options.apiKey) {
      throw new VaultError(
        'E_PROVIDER_NOT_CONFIGURED',
        'OPENAI_API_KEY is required when embeddings are enabled'
      );
    }

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.fetchFn('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts
      })
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      data?: Array<{ embedding?: number[] }>;
    };

    if (!response.ok) {
      throw new VaultError(
        'E_PROVIDER_NOT_CONFIGURED',
        payload.error?.message || 'Embedding request failed'
      );
    }

    const vectors = payload.data?.map((entry) => entry.embedding ?? []);
    if (!vectors || vectors.some((vector) => vector.length === 0)) {
      throw new VaultError('E_PROVIDER_NOT_CONFIGURED', 'Embedding provider returned invalid vectors');
    }

    return vectors;
  }
}

export class OpenAIPlanningProvider implements PlanningProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { apiKey?: string; model: string; fetchFn?: typeof fetch }) {
    if (!options.apiKey) {
      throw new VaultError(
        'E_PROVIDER_NOT_CONFIGURED',
        'OPENAI_API_KEY is required when planning is enabled'
      );
    }

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generatePlan(input: {
    path: string;
    objective?: string;
    style: 'implementation' | 'research' | 'content' | 'ops';
    sourceContent: string;
    relatedContext: Array<{ path: string; snippet: string; relationship: string }>;
  }): Promise<PlanOutput> {
    const response = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return strict JSON with keys summary, goals, constraints, decisions, openQuestions, suggestedActions, handoffPrompt.'
          },
          {
            role: 'user',
            content: JSON.stringify(input)
          }
        ]
      })
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!response.ok) {
      throw new VaultError(
        'E_PROVIDER_NOT_CONFIGURED',
        payload.error?.message || 'Planning request failed'
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new VaultError('E_PROVIDER_NOT_CONFIGURED', 'Planning provider returned empty content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new VaultError('E_PROVIDER_NOT_CONFIGURED', 'Planning provider returned invalid JSON');
    }

    return normalizePlanOutput(parsed);
  }
}

function normalizePlanOutput(value: unknown): PlanOutput {
  const object = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    summary: asString(object.summary),
    goals: asStringArray(object.goals),
    constraints: asStringArray(object.constraints),
    decisions: asStringArray(object.decisions),
    openQuestions: asStringArray(object.openQuestions),
    suggestedActions: asStringArray(object.suggestedActions),
    handoffPrompt: asString(object.handoffPrompt)
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

