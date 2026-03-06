import { spawn } from 'node:child_process';
import { AuditLogger, summarizeArgs } from './audit.js';
import { VaultError } from './errors.js';

export interface CommandSpec {
  tool: string;
  capability: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

const ENV_ALLOWLIST = ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'TEMP', 'TMP'] as const;

export class SafeCommandRunner {
  private readonly auditLogger: AuditLogger;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(auditLogger: AuditLogger, environment: NodeJS.ProcessEnv = process.env) {
    this.auditLogger = auditLogger;
    this.environment = environment;
  }

  async run(spec: CommandSpec): Promise<CommandResult> {
    const startedAt = Date.now();
    const env = pickAllowedEnv(this.environment);

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let killedByTimeout = false;

      const finishWithError = (error: VaultError, exitCode: number | null, status: 'error' = 'error') => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!child.killed) {
          child.kill('SIGTERM');
        }
        this.auditLogger.logExecution({
          ts: new Date().toISOString(),
          tool: spec.tool,
          capability: spec.capability,
          status,
          durationMs: Date.now() - startedAt,
          exitCode,
          cwd: spec.cwd,
          argSummary: summarizeArgs(spec.args)
        });
        reject(error);
      };

      const timer = setTimeout(() => {
        killedByTimeout = true;
        finishWithError(
          new VaultError('E_COMMAND_TIMEOUT', `Command timed out after ${spec.timeoutMs}ms`),
          null
        );
      }, spec.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        stdoutBytes += Buffer.byteLength(chunk, 'utf8');
        if (stdoutBytes + stderrBytes > spec.maxOutputBytes) {
          finishWithError(
            new VaultError('E_OUTPUT_LIMIT_EXCEEDED', `Command output exceeded ${spec.maxOutputBytes} bytes`),
            null
          );
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        stderrBytes += Buffer.byteLength(chunk, 'utf8');
        if (stdoutBytes + stderrBytes > spec.maxOutputBytes) {
          finishWithError(
            new VaultError('E_OUTPUT_LIMIT_EXCEEDED', `Command output exceeded ${spec.maxOutputBytes} bytes`),
            null
          );
        }
      });

      child.on('error', (error) => {
        finishWithError(
          new VaultError('E_COMMAND_FAILED', `Failed to start command: ${error.message}`),
          null
        );
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        const durationMs = Date.now() - startedAt;
        if (killedByTimeout) {
          return;
        }

        if (code !== 0) {
          this.auditLogger.logExecution({
            ts: new Date().toISOString(),
            tool: spec.tool,
            capability: spec.capability,
            status: 'error',
            durationMs,
            exitCode: code,
            cwd: spec.cwd,
            argSummary: summarizeArgs(spec.args)
          });
          reject(
            new VaultError(
              'E_COMMAND_FAILED',
              `Command exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
            )
          );
          return;
        }

        this.auditLogger.logExecution({
          ts: new Date().toISOString(),
          tool: spec.tool,
          capability: spec.capability,
          status: 'success',
          durationMs,
          exitCode: code,
          cwd: spec.cwd,
          argSummary: summarizeArgs(spec.args)
        });

        resolve({
          stdout,
          stderr,
          exitCode: code,
          durationMs
        });
      });
    });
  }
}

function pickAllowedEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};

  for (const key of ENV_ALLOWLIST) {
    const value = environment[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}
