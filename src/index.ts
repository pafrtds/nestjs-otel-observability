// =============================================================================
// NestJS OpenTelemetry Observability Module
// =============================================================================

// Main Module
export { ObservabilityModule } from './observability.module';

// Types and Constants
export {
  ObservabilityModuleOptions,
  ObservabilityModuleAsyncOptions,
  OBSERVABILITY_OPTIONS,
  CustomSemanticAttributes,
  ErrorType,
  StructuredLogEntry,
} from './types/observability.types';

export {
  DEFAULT_SENSITIVE_FIELDS,
  DEFAULT_MAX_BODY_LOG_SIZE,
  DEFAULT_METRICS_EXPORT_INTERVAL_MS,
  DISABLED_INSTRUMENTATIONS,
} from './constants';

// Tracing
export {
  initTracing,
  getTracingSdk,
  shutdownTracing,
  TracingOptions,
} from './tracing/tracing';

// Logger
export {
  StructuredLoggerService,
  createLogger,
} from './logger/structured-logger.service';

export {
  getTraceContextInfo,
  getCurrentSpan,
  getCurrentSpanContext,
  getCurrentTraceId,
  getCurrentSpanId,
  hasActiveTrace,
  TraceContextInfo,
} from './logger/trace-context.util';

export {
  initOtelLogger,
  getOtelLogger,
  isOtelLoggerAvailable,
  markOtlpUnavailable,
  markOtlpAvailable,
  shutdownOtelLogger,
  emitOtelLog,
  LOG_SEVERITY_MAP,
  OtelLoggerOptions,
} from './logger/otel-logger.provider';

// Metrics
export { MetricsService } from './metrics/metrics.service';

// Interceptors
export { ObservabilityErrorInterceptor } from './interceptors/error/observability-error.interceptor';
export { HttpMetricsInterceptor } from './interceptors/http/http-metrics.interceptor';
export { RabbitMQTraceInterceptor } from './interceptors/rabbitmq/rabbitmq-trace.interceptor';
export { RabbitMQPublishInterceptor, AMQP_CONNECTION } from './interceptors/rabbitmq/rabbitmq-publish.interceptor';
export { WebSocketTraceInterceptor, injectTraceContext } from './interceptors/websocket/ws-trace.interceptor';

// Error Utilities
export {
  classifyError,
  isAxiosError,
  isPrismaKnownRequestError,
  isPrismaUnknownRequestError,
  isPrismaValidationError,
  maskHeaders,
  truncateBody,
  extractAxiosErrorInfo,
  extractPrismaKnownErrorInfo,
  extractPrismaUnknownErrorInfo,
  extractGenericErrorInfo,
} from './interceptors/error/error-classifier.util';
