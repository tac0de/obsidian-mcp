import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger, summarizeArgs } from '../src/audit.js';
import { loadExecutionConfig } from '../src/execution-config.js';
import { registerExecutionTools, executionInternals } from '../src/execution.js';
import { VaultError } from '../src/errors.js';
import { SafeCommandRunner } from '../src/safe-command-runner.js';
import { createServer } from '../src/server.js';

const hasRipgrep = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;

let tempDir = '';
let vaultDir = '';
let workspaceDir = '';

async function write(root: string, relPath: string, content: string) {
  const target = path.join(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

function getRegisteredTools(server: McpServer): Record<string, any> {
  return (server as unknown as { _registeredTools: Record<string, any> })._registeredTools;
}

describe('execution layer', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-mcp-exec-'));
    vaultDir = path.join(tempDir, 'vault');
    workspaceDir = path.join(tempDir, 'workspace');

    await fs.mkdir(vaultDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });

    await write(vaultDir, 'note.md', '# Note\nsecure execution');
    await write(workspaceDir, 'alpha.txt', 'alpha\nneedle\n');
    await write(workspaceDir, 'nested/beta.txt', 'beta\nneedle\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps exec tools unregistered when execution is disabled', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir
      }
    });

    const tools = getRegisteredTools(server);
    expect(Object.keys(tools)).not.toContain('exec.list_capabilities');
    expect(Object.keys(tools)).not.toContain('exec.list_dir');
  });

  it('registers only allowlisted execution tools', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir,
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.inspect,workspace.git_status'
      }
    });

    const tools = getRegisteredTools(server);
    expect(Object.keys(tools)).toContain('exec.list_capabilities');
    expect(Object.keys(tools)).toContain('exec.list_dir');
    expect(Object.keys(tools)).toContain('exec.git_status');
    expect(Object.keys(tools)).not.toContain('exec.rg_search');
  });

  it('lists enabled capabilities through MCP handler', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir,
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.inspect'
      }
    });

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(tools['exec.list_capabilities'], {}, {});

    expect(result.structuredContent).toEqual({
      capabilities: [
        {
          name: 'workspace.inspect',
          tool: 'exec.list_dir',
          description: 'List a directory within the configured workspace root using a fixed adapter.'
        }
      ],
      total: 1
    });
  });

  it('runs list_dir against the workspace root', async () => {
    const config = await loadExecutionConfig(
      {
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.inspect'
      },
      workspaceDir
    );
    const server = new McpServer({ name: 'test', version: '1.1.0' });
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);
    registerExecutionTools(server, config, runner);

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(tools['exec.list_dir'], { path: '.', limit: 10 }, {});

    expect(result.structuredContent).toMatchObject({
      path: '.',
      total: 2
    });
    expect(result.structuredContent.entries).toEqual([{ name: 'alpha.txt' }, { name: 'nested' }]);
  });

  it.runIf(hasRipgrep)('runs rg_search with structured matches', async () => {
    const config = await loadExecutionConfig(
      {
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.search'
      },
      workspaceDir
    );
    const server = new McpServer({ name: 'test', version: '1.1.0' });
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);
    registerExecutionTools(server, config, runner);

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(
      tools['exec.rg_search'],
      { query: 'needle', path: '.', limit: 10 },
      {}
    );

    expect(result.structuredContent.total).toBe(2);
    expect(result.structuredContent.matches.map((match: any) => match.path)).toEqual([
      'alpha.txt',
      'nested/beta.txt'
    ]);
  });

  it('runs git_status with structured entries', async () => {
    const config = await loadExecutionConfig(
      {
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.git_status'
      },
      workspaceDir
    );

    spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' });
    await write(workspaceDir, 'tracked.txt', 'hello\n');

    const server = new McpServer({ name: 'test', version: '1.1.0' });
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);
    registerExecutionTools(server, config, runner);

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(tools['exec.git_status'], {}, {});

    expect(result.structuredContent.branch).toBeDefined();
    expect(result.structuredContent.entries.some((entry: any) => entry.path === 'tracked.txt')).toBe(true);
  });

  it('rejects path traversal for execution tools', async () => {
    const config = await loadExecutionConfig(
      {
        EXECUTION_ENABLED: 'true',
        EXECUTION_CAPABILITIES: 'workspace.inspect'
      },
      workspaceDir
    );
    const server = new McpServer({ name: 'test', version: '1.1.0' });
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);
    registerExecutionTools(server, config, runner);

    const tools = getRegisteredTools(server);

    await expect(server.executeToolHandler(tools['exec.list_dir'], { path: '../outside' }, {})).rejects.toMatchObject({
      code: expect.anything(),
      message: expect.stringContaining('E_PATH_TRAVERSAL')
    });
  });

  it('does not interpret shell metacharacters in safe runner arguments', async () => {
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);
    const result = await runner.run({
      tool: 'exec.test',
      capability: 'workspace.inspect',
      command: 'node',
      args: ['-e', 'console.log(process.argv[1])', 'value; echo injected'],
      cwd: workspaceDir,
      timeoutMs: 5_000,
      maxOutputBytes: 8_192
    });

    expect(result.stdout.trim()).toBe('value; echo injected');
  });

  it('enforces command timeout and output limits', async () => {
    const runner = new SafeCommandRunner(new AuditLogger(), process.env);

    await expect(
      runner.run({
        tool: 'exec.test',
        capability: 'workspace.inspect',
        command: 'node',
        args: ['-e', 'setTimeout(() => console.log("slow"), 200)'],
        cwd: workspaceDir,
        timeoutMs: 50,
        maxOutputBytes: 8_192
      })
    ).rejects.toMatchObject({ code: 'E_COMMAND_TIMEOUT' } satisfies Partial<VaultError>);

    await expect(
      runner.run({
        tool: 'exec.test',
        capability: 'workspace.inspect',
        command: 'node',
        args: ['-e', 'console.log("x".repeat(5000))'],
        cwd: workspaceDir,
        timeoutMs: 5_000,
        maxOutputBytes: 128
      })
    ).rejects.toMatchObject({ code: 'E_OUTPUT_LIMIT_EXCEEDED' } satisfies Partial<VaultError>);
  });

  it('writes minimal audit logs and truncates arg summaries', () => {
    const logger = new AuditLogger();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    logger.logExecution({
      ts: '2026-03-06T00:00:00.000Z',
      tool: 'exec.test',
      capability: 'workspace.inspect',
      status: 'success',
      durationMs: 12,
      exitCode: 0,
      cwd: '/tmp/workspace',
      argSummary: summarizeArgs(['--query', 'needle', 'x'.repeat(200)])
    });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = String(stderrSpy.mock.calls[0][0]).trim();
    const parsed = JSON.parse(payload);

    expect(parsed).toMatchObject({
      tool: 'exec.test',
      capability: 'workspace.inspect',
      status: 'success',
      durationMs: 12,
      exitCode: 0
    });
    expect(parsed.argSummary.length).toBeLessThanOrEqual(160);
  });

  it('parses command adapter outputs deterministically', () => {
    expect(
      executionInternals.parseGitStatus('## main...origin/main\n M alpha.txt\nR  old.txt -> new.txt\n')
    ).toEqual({
      branch: 'main...origin/main',
      entries: [
        { path: 'alpha.txt', status: 'M' },
        { path: 'new.txt', status: 'R', originalPath: 'old.txt' }
      ]
    });

    expect(
      executionInternals.parseRipgrepJson(
        [
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'nested/beta.txt' },
              line_number: 2,
              lines: { text: 'needle\n' }
            }
          })
        ].join('\n')
      )
    ).toEqual([{ path: 'nested/beta.txt', lineNumber: 2, line: 'needle' }]);
  });
});
