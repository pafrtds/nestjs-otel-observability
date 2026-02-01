/**
 * Observability module configuration options
 */
export interface ObservabilityModuleOptions {
  /**
   * Service name (required)
   * @example 'messaging-service'
   */
  serviceName: string;

  /**
   * Service version
   * @default '1.0.0'
   */
  serviceVersion?: string;

  /**
   * Execution environment
   * @default 'development'
   */
  environment?: string;

  /**
   * Enable HTTP instrumentation
   * @default true
   */
  enableHttp?: boolean;

  /**
   * Enable RabbitMQ instrumentation
   * @default true
   */
  enableRabbit?: boolean;

  /**
   * Enable WebSocket instrumentation
   * @default true
   */
  enableWebSocket?: boolean;

  /**
   * OTLP endpoint for traces
   * @default 'http://localhost:4318/v1/traces'
   */
  otlpTraceEndpoint?: string;

  /**
   * OTLP endpoint for metrics
   * @default 'http://localhost:4318/v1/metrics'
   */
  otlpMetricsEndpoint?: string;

  /**
   * OTLP endpoint for logs
   * @default 'http://localhost:4318/v1/logs'
   */
  otlpLogsEndpoint?: string;

  /**
   * Enable metrics collection
   * @default true
   */
  enableMetrics?: boolean;

  /**
   * Enable OTLP log export
   * @default true (logs are sent to OTLP Collector)
   */
  enableOtlpLogs?: boolean;

  /**
   * Enable console logging
   * @default true
   */
  enableConsoleLogs?: boolean;

  /**
   * Log level
   * @default 'info'
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Sensitive fields for masking in logs
   * @default ['password', 'token', 'authorization', 'secret', 'key', 'apikey']
   */
  sensitiveFields?: string[];

  /**
   * Maximum body size to log (bytes)
   * @default 10000
   */
  maxBodyLogSize?: number;

  /**
   * Metrics export interval in milliseconds
   * @default 15000
   */
  metricsExportIntervalMs?: number;

  /**
   * Enable debug mode (verbose OTel logging)
   * @default false
   */
  debug?: boolean;
}

/**
 * Injection token for module options
 */
export const OBSERVABILITY_OPTIONS = 'OBSERVABILITY_OPTIONS';

/**
 * Custom semantic attributes for telemetry
 */
export const CustomSemanticAttributes = {
  // RabbitMQ
  MESSAGING_RABBITMQ_EXCHANGE: 'messaging.rabbitmq.exchange',
  MESSAGING_RABBITMQ_ROUTING_KEY: 'messaging.rabbitmq.routing_key',
  MESSAGING_RABBITMQ_QUEUE: 'messaging.rabbitmq.queue',

  // WebSocket
  WS_EVENT_NAME: 'ws.event.name',
  WS_CLIENT_ID: 'ws.client.id',

  // Error handling
  ERROR_TYPE: 'error.type',
  ERROR_CODE: 'error.code',

  // Prisma
  PRISMA_MODEL: 'db.prisma.model',
  PRISMA_ERROR_CODE: 'db.prisma.error_code',
  PRISMA_ERROR_FIELD: 'db.prisma.error_field',

  // Axios
  HTTP_REQUEST_BODY_SIZE: 'http.request.body.size',
  HTTP_RESPONSE_BODY_SIZE: 'http.response.body.size',
};

/**
 * Supported error types
 */
export enum ErrorType {
  AXIOS = 'AxiosError',
  PRISMA_KNOWN = 'PrismaClientKnownRequestError',
  PRISMA_UNKNOWN = 'PrismaClientUnknownRequestError',
  PRISMA_VALIDATION = 'PrismaClientValidationError',
  HTTP = 'HttpError',
  WEBSOCKET = 'WebSocketError',
  RABBITMQ = 'RabbitMQError',
  GENERIC = 'Error',
}

/**
 * Structured log entry interface
 */
export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  service: string;
  environment: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

/**
 * Async module options for dynamic configuration
 */
export interface ObservabilityModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<ObservabilityModuleOptions> | ObservabilityModuleOptions;
  inject?: any[];
}
