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
}

const config: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
  timestamps: true,
  json: process.env.NODE_ENV === "production",
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
  const timestamp = config.timestamps
    ? `[${new Date().toISOString().slice(11, 23)}] `
    : "";
  const levelTag = `[${level.toUpperCase().padEnd(5)}]`;
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";

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
      errorContext.error = String(err);
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
