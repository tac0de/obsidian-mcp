import { promises as fs } from 'node:fs';
import path from 'node:path';

export const EXECUTION_CAPABILITIES = [
  'workspace.search',
  'workspace.inspect',
  'workspace.git_status'
] as const;

export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export interface ExecutionConfig {
  enabled: boolean;
  capabilities: Set<ExecutionCapability>;
  workspaceRoot: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32_768;

export async function loadExecutionConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): Promise<ExecutionConfig> {
  const enabled = parseBoolean(env.EXECUTION_ENABLED);
  const workspaceRoot = await fs.realpath(path.resolve(cwd));
  const timeoutMs = parsePositiveInt(env.EXECUTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'EXECUTION_TIMEOUT_MS');
  const maxOutputBytes = parsePositiveInt(
    env.EXECUTION_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_BYTES,
    'EXECUTION_MAX_OUTPUT_BYTES'
  );

  return {
    enabled,
    capabilities: enabled ? parseCapabilities(env.EXECUTION_CAPABILITIES) : new Set<ExecutionCapability>(),
    workspaceRoot,
    timeoutMs,
    maxOutputBytes
  };
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveInt(raw: string | undefined, fallback: number, envName: string): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive number`);
  }

  return Math.floor(parsed);
}

function parseCapabilities(raw: string | undefined): Set<ExecutionCapability> {
  if (!raw?.trim()) {
    return new Set<ExecutionCapability>();
  }

  const requested = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is ExecutionCapability =>
      (EXECUTION_CAPABILITIES as readonly string[]).includes(value)
    );

  return new Set<ExecutionCapability>(requested);
}
