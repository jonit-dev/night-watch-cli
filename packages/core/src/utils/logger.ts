/**
 * Structured logger for Night Watch agent actions and server events.
 *
 * Writes timestamped lines to stdout/stderr so they appear in server logs.
 * Format: ISO_TIMESTAMP [LEVEL] [context] message key=value ...
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
} as const;

const NO_COLOR = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';

function colorize(color: string, text: string): string {
  return NO_COLOR ? text : `${color}${text}${ANSI.reset}`;
}

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

interface ILevelStyle {
  label: string;
  color: string;
}

const LEVEL_STYLES: Record<LogLevel, ILevelStyle> = {
  debug: { label: 'DEBUG', color: ANSI.magenta },
  info:  { label: 'INFO ', color: ANSI.green },
  warn:  { label: 'WARN ', color: ANSI.yellow },
  error: { label: 'ERROR', color: ANSI.red },
};

export class Logger {
  constructor(private readonly context: string) {}

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    const { label, color } = LEVEL_STYLES[level];
    const ts = colorize(ANSI.dim, new Date().toISOString());
    const lvl = colorize(`${ANSI.bold}${color}`, `[${label}]`);
    const ctx = colorize(ANSI.cyan, `[${this.context}]`);
    const msg = level === 'error' ? colorize(color, message) : message;
    const metaStr = meta ? formatMeta(meta) : '';
    const line = `${ts} ${lvl} ${ctx} ${msg}${metaStr}`;
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
