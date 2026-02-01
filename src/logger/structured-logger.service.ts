import { Injectable, LoggerService, Inject, Optional, Scope } from '@nestjs/common';
import { getTraceContextInfo } from './trace-context.util';
import { emitOtelLog, isOtelLoggerAvailable } from './otel-logger.provider';
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  StructuredLogEntry,
} from '../types/observability.types';
import { DEFAULT_SENSITIVE_FIELDS } from '../constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger with OpenTelemetry and console support
 *
 * Behavior:
 * - Development: formatted console logs
 * - Production: OTLP logs to Collector
 * - Always includes trace_id and span_id automatically
 * - Resilience: falls back to console if OTLP fails
 */
@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLoggerService implements LoggerService {
  private context?: string;

  private readonly serviceName: string;

  private readonly environment: string;

  private readonly logLevel: LogLevel;

  private readonly sensitiveFields: string[];

  private readonly enableOtlpLogs: boolean;

  private readonly enableConsoleLogs: boolean;

  constructor(
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {
    this.serviceName = options?.serviceName || process.env.SERVICE_NAME || 'unknown-service';
    this.environment = options?.environment || process.env.NODE_ENV || 'development';
    this.logLevel = options?.logLevel || 'info';
    this.sensitiveFields = options?.sensitiveFields || DEFAULT_SENSITIVE_FIELDS;

    // Configure log destinations - controlled by variables/options
    // Default: both enabled (true) if not explicitly defined
    this.enableOtlpLogs = options?.enableOtlpLogs ?? (process.env.OTEL_LOGS_ENABLED !== 'false');
    this.enableConsoleLogs = options?.enableConsoleLogs ?? (process.env.OTEL_CONSOLE_LOGS_ENABLED !== 'false');
  }

  /**
   * Set the logger context (usually the class name)
   */
  setContext(context: string): this {
    this.context = context;
    return this;
  }

  /**
   * Debug level log
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('debug', message, meta);
  }

  /**
   * Info level log (alias for log)
   */
  log(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('info', message, meta);
  }

  /**
   * Warn level log
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('warn', message, meta);
  }

  /**
   * Error level log
   */
  error(message: string, trace?: string, meta?: Record<string, unknown>): void {
    this.writeLog('error', message, {
      ...meta,
      stack_trace: trace,
    });
  }

  /**
   * Verbose log (mapped to debug)
   */
  verbose(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('debug', message, meta);
  }

  /**
   * Structured error log with detailed information
   */
  logError(error: Error, meta?: Record<string, unknown>): void {
    this.writeLog('error', error.message, {
      ...meta,
      error_name: error.name,
      stack_trace: error.stack,
    });
  }

  /**
   * Create a structured log entry with trace context
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): StructuredLogEntry {
    const traceContext = getTraceContextInfo();

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.serviceName,
      environment: this.environment,
    };

    // Add trace context if available
    if (traceContext.traceId) {
      entry.trace_id = traceContext.traceId;
    }

    if (traceContext.spanId) {
      entry.span_id = traceContext.spanId;
    }

    // Add logger context if set
    if (this.context) {
      entry.context = this.context;
    }

    // Add additional metadata (with masking)
    if (meta) {
      const maskedMeta = this.maskSensitiveData(meta);
      Object.assign(entry, maskedMeta);
    }

    return entry;
  }

  /**
   * Write the log via OTLP and/or console
   */
  private writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    // Check log level
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.logLevel]) {
      return;
    }

    const entry = this.createLogEntry(level, message, meta);

    let otlpSuccess = false;

    // Try to send via OTLP if enabled
    if (this.enableOtlpLogs && isOtelLoggerAvailable()) {
      otlpSuccess = emitOtelLog(level, message, {
        ...entry,
        // Remove fields that are already part of the log record
        timestamp: undefined,
        level: undefined,
        message: undefined,
      });
    }

    // Write to console if:
    // 1. Console is enabled (development), OR
    // 2. OTLP failed and we need fallback
    if (this.enableConsoleLogs || (!otlpSuccess && this.enableOtlpLogs)) {
      this.writeToConsole(level, entry);
    }
  }

  /**
   * Write the log to console (formatted for development or JSON for production)
   */
  private writeToConsole(level: LogLevel, entry: StructuredLogEntry): void {
    // In development, format in a more readable way
    if (this.environment === 'development') {
      const { timestamp, level: logLevel, message, context, trace_id, ...rest } = entry;

      const contextStr = context ? `[${context}] ` : '';
      const traceStr = trace_id ? ` (trace: ${trace_id.substring(0, 8)}...)` : '';
      const metaStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';

      const formattedMessage = `${timestamp} ${logLevel.toUpperCase().padEnd(5)} ${contextStr}${message}${traceStr}${metaStr}`;

      switch (level) {
        case 'error':
          console.error(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'debug':
          console.debug(formattedMessage);
          break;
        default:
          console.log(formattedMessage);
      }
    } else {
      // In production, structured JSON (compatible with Loki via Promtail)
      const output = JSON.stringify(entry);

      switch (level) {
        case 'error':
          console.error(output);
          break;
        case 'warn':
          console.warn(output);
          break;
        case 'debug':
          console.debug(output);
          break;
        default:
          console.log(output);
      }
    }
  }

  /**
   * Mask sensitive data in objects
   */
  private maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Check if it's a sensitive field
      const isSensitive = this.sensitiveFields.some((field) =>
        lowerKey.includes(field.toLowerCase()),
      );

      if (isSensitive) {
        masked[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively mask nested objects
        masked[key] = this.maskSensitiveData(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        // Mask arrays of objects
        masked[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? this.maskSensitiveData(item as Record<string, unknown>)
            : item,
        );
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }
}

/**
 * Factory to create logger with context
 */
export function createLogger(
  context: string,
  options?: ObservabilityModuleOptions,
): StructuredLoggerService {
  const logger = new StructuredLoggerService(options);
  logger.setContext(context);
  return logger;
}
