import { promises as fs } from 'node:fs';
import path from 'node:path';
import { VaultError } from './errors.js';

export type SupportedProvider = 'openai';

export interface EmbeddingConfig {
  enabled: boolean;
  provider: SupportedProvider;
  model: string;
  sqlitePath: string;
  apiKey?: string;
}

export interface PlanningConfig {
  enabled: boolean;
  provider: SupportedProvider;
  model: string;
  apiKey?: string;
}

const DEFAULT_SQLITE_PATH = '.knowledge-to-action-mcp/index.sqlite';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_PLANNING_MODEL = 'gpt-4.1-mini';

export async function loadEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): Promise<EmbeddingConfig> {
  const provider = parseProvider(env.EMBEDDING_PROVIDER, 'EMBEDDING_PROVIDER');
  const sqlitePath = path.resolve(cwd, env.EMBEDDING_SQLITE_PATH?.trim() || DEFAULT_SQLITE_PATH);
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });

  return {
    enabled: parseBoolean(env.EMBEDDINGS_ENABLED),
    provider,
    model: env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    sqlitePath,
    apiKey: env.OPENAI_API_KEY?.trim() || undefined
  };
}

export function loadPlanningConfig(env: NodeJS.ProcessEnv = process.env): PlanningConfig {
  return {
    enabled: parseBoolean(env.PLANNING_ENABLED),
    provider: parseProvider(env.PLANNING_PROVIDER, 'PLANNING_PROVIDER'),
    model: env.PLANNING_MODEL?.trim() || DEFAULT_PLANNING_MODEL,
    apiKey: env.OPENAI_API_KEY?.trim() || undefined
  };
}

function parseProvider(raw: string | undefined, envName: string): SupportedProvider {
  const value = raw?.trim().toLowerCase() || 'openai';
  if (value === 'openai') {
    return value;
  }

  throw new VaultError('E_UNKNOWN_PROVIDER', `${envName} must be one of: openai`);
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

