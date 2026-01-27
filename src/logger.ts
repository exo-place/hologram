/**
 * Structured Logger
 *
 * Lightweight logger with:
 * - Log levels (debug, info, warn, error)
 * - Timestamps
 * - Structured context
 * - Configurable output
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LoggerConfig {
  level: LogLevel;
  /** Include timestamps in output */
  timestamps: boolean;
  /** JSON output for production, pretty for dev */
  json: boolean;
  /** Colorize output (auto-detected from TTY by default) */
  colors: boolean;
}

const config: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
  timestamps: true,
  json: process.env.NODE_ENV === "production",
  colors: process.stdout.isTTY ?? false,
};

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

/** Configure the logger */
export function configureLogger(options: Partial<LoggerConfig>): void {
  Object.assign(config, options);
}

/** Format a log entry */
function formatEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): string {
  if (config.json) {
    return JSON.stringify({
      level,
      message,
      ...(config.timestamps && { timestamp: new Date().toISOString() }),
      ...context,
    });
  }

  // Pretty format for dev
  const c = config.colors;
  const timestamp = config.timestamps
    ? `${c ? COLORS.dim : ""}[${new Date().toISOString().slice(11, 23)}]${c ? COLORS.reset : ""} `
    : "";
  const color = c ? LEVEL_COLORS[level] : "";
  const reset = c ? COLORS.reset : "";
  const levelTag = `${color}[${level.toUpperCase().padEnd(5)}]${reset}`;
  const contextStr = context
    ? ` ${c ? COLORS.dim : ""}${JSON.stringify(context)}${reset}`
    : "";

  return `${timestamp}${levelTag} ${message}${contextStr}`;
}

/** Check if a level should be logged */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

/** Log a debug message */
export function debug(message: string, context?: Record<string, unknown>): void {
  if (shouldLog("debug")) {
    console.debug(formatEntry("debug", message, context));
  }
}

/** Log an info message */
export function info(message: string, context?: Record<string, unknown>): void {
  if (shouldLog("info")) {
    console.info(formatEntry("info", message, context));
  }
}

/** Log a warning */
export function warn(message: string, context?: Record<string, unknown>): void {
  if (shouldLog("warn")) {
    console.warn(formatEntry("warn", message, context));
  }
}

/** Log an error */
export function error(
  message: string,
  err?: Error | unknown,
  context?: Record<string, unknown>
): void {
  if (shouldLog("error")) {
    const errorContext: Record<string, unknown> = { ...context };
    if (err instanceof Error) {
      errorContext.error = err.message;
      errorContext.stack = err.stack;
    } else if (err !== undefined) {
      // Try to serialize objects properly
      try {
        errorContext.error = typeof err === "object" ? JSON.stringify(err) : String(err);
      } catch {
        errorContext.error = String(err);
      }
    }
    console.error(formatEntry("error", message, errorContext));
  }
}

/** Create a child logger with preset context */
export function child(baseContext: Record<string, unknown>): {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, err?: Error | unknown, context?: Record<string, unknown>) => void;
} {
  return {
    debug: (message, context) => debug(message, { ...baseContext, ...context }),
    info: (message, context) => info(message, { ...baseContext, ...context }),
    warn: (message, context) => warn(message, { ...baseContext, ...context }),
    error: (message, err, context) => error(message, err, { ...baseContext, ...context }),
  };
}

/** Default export for convenient import */
export default { debug, info, warn, error, child, configureLogger };
