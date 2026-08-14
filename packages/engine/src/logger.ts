/**
 * Production-safe logger utility
 * Provides environment-aware logging with different levels
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LoggerConfig {
  level: LogLevel;
  enableInProduction: boolean;
  sanitizeErrors: boolean;
}

class Logger {
  private config: LoggerConfig;
  private isDevelopment: boolean;

  constructor() {
    // Use NODE_ENV for environment detection to keep test runners compatible
    this.isDevelopment = process.env.NODE_ENV === 'development';
    
    this.config = {
      level: this.isDevelopment ? LogLevel.DEBUG : LogLevel.ERROR,
      enableInProduction: false,
      sanitizeErrors: true,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.isDevelopment && !this.config.enableInProduction) {
      return false;
    }
    return level <= this.config.level;
  }

  private sanitizeError(error: unknown): string {
    if (!this.config.sanitizeErrors) {
      return String(error);
    }

    // In production, sanitize error messages to avoid leaking sensitive info
    if (error instanceof Error) {
      // Remove file paths and stack traces in production
      if (!this.isDevelopment) {
        return error.message.replace(/\/[\w\-/. ]+\.(ts|tsx|js|jsx)/g, '[file]');
      }
      return error.message;
    }
    
    return 'An error occurred';
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    
    // In development, use console methods directly
    if (this.isDevelopment) {
      switch (level) {
        case 'ERROR':
          console.error(prefix, message, ...args);
          break;
        case 'WARN':
          console.warn(prefix, message, ...args);
          break;
        case 'INFO':
          console.info(prefix, message, ...args);
          break;
        case 'DEBUG':
          console.log(prefix, message, ...args);
          break;
      }
    } else if (this.config.enableInProduction) {
      // In production, could send to monitoring service instead
      // For now, just use console.log with sanitized output
      console.log(prefix, message, ...args.map(arg => 
        arg instanceof Error ? this.sanitizeError(arg) : arg
      ));
    }
  }

  error(message: string, error?: unknown, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorMessage = error ? this.sanitizeError(error) : '';
      this.formatMessage('ERROR', message, errorMessage, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.formatMessage('WARN', message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.formatMessage('INFO', message, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.formatMessage('DEBUG', message, ...args);
    }
  }

  // Configure logger at runtime
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const logger = new Logger();

// Export default for convenience
export default logger;
