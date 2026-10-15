/**
 * Structured Application Logger
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private level: LogLevel;
  private context: string;

  constructor(context = "App", level: LogLevel = "info") {
    this.context = context;
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}]: ${message}${metaStr}`;
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  public error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      const errMeta = {
        ...meta,
        ...(error instanceof Error
          ? { errorMessage: error.message, stack: error.stack }
          : error !== undefined
          ? { rawError: error }
          : {}),
      };
      console.error(this.formatMessage("error", message, errMeta));
    }
  }

  public child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, this.level);
  }
}

export const logger = new Logger("FreJunApp", (process.env.LOG_LEVEL as LogLevel) || "info");
