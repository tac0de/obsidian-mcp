import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExecutionConfig, ExecutionCapability } from './execution-config.js';
import { toolSchemas } from './schemas.js';
import { toMcpError, VaultError } from './errors.js';
import type { SafeCommandRunner } from './safe-command-runner.js';

interface ExecutionToolDefinition {
  toolName: string;
  capability: ExecutionCapability;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  handler: (
    input: Record<string, unknown>,
    config: ExecutionConfig,
    runner: SafeCommandRunner
  ) => Promise<Record<string, unknown>>;
}

const executionTools: ExecutionToolDefinition[] = [
  {
    toolName: 'exec.rg_search',
    capability: 'workspace.search',
    description: 'Run a capability-scoped ripgrep search within the configured workspace root.',
    inputSchema: toolSchemas.execRgSearchInputSchema.shape,
    outputSchema: toolSchemas.execRgSearchOutputSchema.shape,
    handler: runRipgrepSearch
  },
  {
    toolName: 'exec.list_dir',
    capability: 'workspace.inspect',
    description: 'List a directory within the configured workspace root using a fixed adapter.',
    inputSchema: toolSchemas.execListDirInputSchema.shape,
    outputSchema: toolSchemas.execListDirOutputSchema.shape,
    handler: runListDirectory
  },
  {
    toolName: 'exec.git_status',
    capability: 'workspace.git_status',
    description: 'Return `git status --short --branch` for the configured workspace root.',
    inputSchema: toolSchemas.execGitStatusInputSchema.shape,
    outputSchema: toolSchemas.execGitStatusOutputSchema.shape,
    handler: runGitStatus
  }
];

export function registerExecutionTools(
  server: McpServer,
  config: ExecutionConfig,
  runner: SafeCommandRunner
): void {
  if (!config.enabled) {
    return;
  }

  server.registerTool(
    'exec.list_capabilities',
    {
      description: 'List the execution capabilities currently enabled on this server.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: toolSchemas.execListCapabilitiesInputSchema.shape,
      outputSchema: toolSchemas.execListCapabilitiesOutputSchema.shape
    },
    async () => {
      try {
        const capabilities = executionTools
          .filter((tool) => config.capabilities.has(tool.capability))
          .map((tool) => ({
            name: tool.capability,
            tool: tool.toolName,
            description: tool.description
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return toToolResult({
          capabilities,
          total: capabilities.length
        });
      } catch (error) {
        throw toMcpError(error);
      }
    }
  );

  for (const tool of executionTools) {
    if (!config.capabilities.has(tool.capability)) {
      continue;
    }

    server.registerTool(
      tool.toolName,
      {
        description: tool.description,
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: tool.inputSchema as any,
        outputSchema: tool.outputSchema as any
      },
      async (input: Record<string, unknown>) => {
        try {
          ensureExecutionEnabled(config);
          ensureCapabilityEnabled(config, tool.capability);
          const output = await tool.handler(input as Record<string, unknown>, config, runner);
          return toToolResult(output);
        } catch (error) {
          throw toMcpError(error);
        }
      }
    );
  }
}

function toToolResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

async function runRipgrepSearch(
  input: Record<string, unknown>,
  config: ExecutionConfig,
  runner: SafeCommandRunner
): Promise<Record<string, unknown>> {
  const query = requireString(input.query, 'query');
  const requestedPath = optionalString(input.path);
  const limit = optionalPositiveInt(input.limit, 50, 500);
  const targetPath = await resolveWorkspacePath(config.workspaceRoot, requestedPath ?? '.');
  const relativeTarget = normalizeRelativePath(config.workspaceRoot, targetPath);

  const result = await runner.run({
    tool: 'exec.rg_search',
    capability: 'workspace.search',
    command: 'rg',
    args: ['--json', '--line-number', '--color', 'never', query, relativeTarget],
    cwd: config.workspaceRoot,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });

  const matches = parseRipgrepJson(result.stdout).slice(0, limit);
  return {
    query,
    path: relativeTarget,
    matches,
    total: matches.length,
    durationMs: result.durationMs
  };
}

async function runListDirectory(
  input: Record<string, unknown>,
  config: ExecutionConfig,
  runner: SafeCommandRunner
): Promise<Record<string, unknown>> {
  const requestedPath = optionalString(input.path);
  const limit = optionalPositiveInt(input.limit, 100, 500);
  const targetPath = await resolveWorkspacePath(config.workspaceRoot, requestedPath ?? '.');
  const relativeTarget = normalizeRelativePath(config.workspaceRoot, targetPath);

  const result = await runner.run({
    tool: 'exec.list_dir',
    capability: 'workspace.inspect',
    command: 'ls',
    args: ['-1A', relativeTarget],
    cwd: config.workspaceRoot,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });

  const allEntries = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    path: relativeTarget,
    entries: allEntries.slice(0, limit).map((name) => ({ name })),
    total: allEntries.length,
    durationMs: result.durationMs
  };
}

async function runGitStatus(
  _input: Record<string, unknown>,
  config: ExecutionConfig,
  runner: SafeCommandRunner
): Promise<Record<string, unknown>> {
  const result = await runner.run({
    tool: 'exec.git_status',
    capability: 'workspace.git_status',
    command: 'git',
    args: ['status', '--short', '--branch', '--porcelain=v1'],
    cwd: config.workspaceRoot,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });

  const parsed = parseGitStatus(result.stdout);
  return {
    branch: parsed.branch,
    entries: parsed.entries,
    total: parsed.entries.length,
    durationMs: result.durationMs
  };
}

function parseRipgrepJson(stdout: string): Array<{ path: string; lineNumber: number; line: string }> {
  const results: Array<{ path: string; lineNumber: number; line: string }> = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== 'match') {
      continue;
    }

    const matchPath = parsed.data?.path?.text;
    const lineNumber = parsed.data?.line_number;
    const text = parsed.data?.lines?.text;

    if (typeof matchPath === 'string' && typeof lineNumber === 'number' && typeof text === 'string') {
      results.push({
        path: toPosixPath(matchPath).replace(/^\.\//, ''),
        lineNumber,
        line: text.trimEnd()
      });
    }
  }

  return results.sort((a, b) => {
    if (a.path === b.path) {
      return a.lineNumber - b.lineNumber;
    }
    return a.path.localeCompare(b.path);
  });
}

function parseGitStatus(stdout: string): {
  branch?: string;
  entries: Array<{ path: string; status: string; originalPath?: string }>;
} {
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
  const entries: Array<{ path: string; status: string; originalPath?: string }> = [];
  let branch: string | undefined;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      branch = line.slice(3).trim();
      continue;
    }

    const status = line.slice(0, 2).trim() || '??';
    const rawPath = line.slice(3).trim();

    if (rawPath.includes(' -> ')) {
      const [originalPath, renamedPath] = rawPath.split(' -> ');
      entries.push({
        path: toPosixPath(renamedPath),
        status,
        originalPath: toPosixPath(originalPath)
      });
      continue;
    }

    entries.push({
      path: toPosixPath(rawPath),
      status
    });
  }

  return { branch, entries };
}

async function resolveWorkspacePath(rootPath: string, requestedPath: string): Promise<string> {
  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new VaultError('E_INVALID_PATH', 'Path is required');
  }

  if (path.isAbsolute(requestedPath)) {
    throw new VaultError('E_PATH_TRAVERSAL', 'Absolute paths are not allowed');
  }

  const normalized = path.normalize(requestedPath);
  const candidate = path.resolve(rootPath, normalized);
  const rootWithSep = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;

  if (!(candidate === rootPath || candidate.startsWith(rootWithSep))) {
    throw new VaultError('E_PATH_TRAVERSAL', 'Path traversal is not allowed');
  }

  try {
    const real = await fs.realpath(candidate);
    if (!(real === rootPath || real.startsWith(rootWithSep))) {
      throw new VaultError('E_PATH_TRAVERSAL', 'Symlink path traversal is not allowed');
    }
    return real;
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }

    throw new VaultError('E_FILE_NOT_FOUND', `Path not found: ${requestedPath}`);
  }
}

function normalizeRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' ? '.' : toPosixPath(relative);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VaultError('E_INVALID_PATH', `${fieldName} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number') {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new VaultError('E_INVALID_PATH', `limit must be an integer between 1 and ${max}`);
  }

  return value;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export const executionInternals = {
  parseGitStatus,
  parseRipgrepJson
};

function ensureExecutionEnabled(config: ExecutionConfig): void {
  if (!config.enabled) {
    throw new VaultError('E_EXECUTION_DISABLED', 'Execution tools are disabled');
  }
}

function ensureCapabilityEnabled(config: ExecutionConfig, capability: ExecutionCapability): void {
  if (!config.capabilities.has(capability)) {
    throw new VaultError('E_CAPABILITY_DENIED', `Capability is not enabled: ${capability}`);
  }
}
