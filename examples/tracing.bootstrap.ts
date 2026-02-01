/**
 * Tracing Bootstrap Example
 *
 * This file should be imported as the FIRST import in your main.ts
 * to ensure OpenTelemetry is initialized before any other modules.
 *
 * @example
 * // main.ts
 * import './tracing.bootstrap'; // MUST be first!
 * import { NestFactory } from '@nestjs/core';
 * import { AppModule } from './app.module';
 */

import { initTracing } from '@anfitriao/nestjs-otel-observability';

initTracing({
  // Service identification
  serviceName: process.env.SERVICE_NAME || 'my-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',

  // OTLP endpoints (defaults to local collector)
  otlpTraceEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  otlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || 'http://localhost:4318/v1/metrics',
  otlpLogsEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs',

  // Feature toggles
  enableMetrics: process.env.OTEL_METRICS_ENABLED !== 'false',
  enableOtlpLogs: process.env.OTEL_LOGS_ENABLED !== 'false',
  enableConsoleLogs: process.env.OTEL_CONSOLE_LOGS_ENABLED !== 'false',

  // Metrics export interval (milliseconds)
  metricsExportIntervalMs: Number(process.env.OTEL_METRICS_EXPORT_INTERVAL_MS) || 15000,

  // Debug mode (verbose OpenTelemetry logging)
  debug: process.env.OTEL_DEBUG === 'true',
});
