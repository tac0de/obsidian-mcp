export interface AuditLogEntry {
  ts: string;
  tool: string;
  capability: string;
  status: 'success' | 'error';
  durationMs: number;
  exitCode: number | null;
  cwd: string;
  argSummary: string;
}

export class AuditLogger {
  logExecution(entry: AuditLogEntry): void {
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  }
}

export function summarizeArgs(args: string[]): string {
  const parts = args.map((value) => redactValue(value));
  return truncate(parts.join(' '), 160);
}

function redactValue(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return '""';
  }
  return truncate(normalized, 48);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
