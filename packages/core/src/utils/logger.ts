/**
 * Structured logger for Night Watch agent actions and server events.
 *
 * Writes timestamped lines to stdout/stderr so they appear in server logs.
 * Format: ISO_TIMESTAMP [LEVEL] [context] message key=value ...
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

function serializeValue(v: unknown): string {
  if (v instanceof Error) return JSON.stringify(v.message);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null || v === undefined) return String(v);
  return JSON.stringify(v);
}

function formatMeta(meta: LogMeta): string {
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${serializeValue(v)}`);
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export class Logger {
  constructor(private readonly context: string) {}

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    const ts = new Date().toISOString();
    const line = `${ts} [${LEVEL_LABELS[level]}] [${this.context}] ${message}${meta ? formatMeta(meta) : ''}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.write('error', message, meta);
  }
}

/**
 * Create a Logger instance scoped to a named context.
 * Intended to be used at module level: `const log = createLogger('deliberation')`
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
