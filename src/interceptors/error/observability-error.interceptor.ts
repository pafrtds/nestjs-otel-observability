import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  ErrorType,
} from '../../types/observability.types';
import { StructuredLoggerService } from '../../logger/structured-logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import {
  classifyError,
  extractAxiosErrorInfo,
  extractPrismaKnownErrorInfo,
  extractPrismaUnknownErrorInfo,
  extractGenericErrorInfo,
  isAxiosError,
  isPrismaKnownRequestError,
  isPrismaUnknownRequestError,
} from './error-classifier.util';
import { DEFAULT_SENSITIVE_FIELDS, DEFAULT_MAX_BODY_LOG_SIZE } from '../../constants';

// Type for Socket.IO client (optional dependency)
interface SocketLike {
  id: string;
}

type ContextType = 'http' | 'ws' | 'rpc' | 'rmq';

/**
 * Global Error Interceptor with Observability
 *
 * Captures errors from HTTP, RabbitMQ and WebSocket, recording:
 * - Structured logs with trace context
 * - Span exceptions in OpenTelemetry
 * - Error metrics
 * - Detailed classification by error type
 */
@Injectable()
export class ObservabilityErrorInterceptor implements NestInterceptor {
  private readonly logger: StructuredLoggerService;

  private readonly sensitiveFields: string[];

  private readonly maxBodySize: number;

  constructor(
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {
    this.logger = new StructuredLoggerService(options);
    this.logger.setContext('ObservabilityErrorInterceptor');
    this.sensitiveFields = options?.sensitiveFields || DEFAULT_SENSITIVE_FIELDS;
    this.maxBodySize = options?.maxBodyLogSize || DEFAULT_MAX_BODY_LOG_SIZE;
  }

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        this.handleError(error, executionContext);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Process error based on execution context
   */
  private handleError(error: unknown, executionContext: ExecutionContext): void {
    const handler = executionContext.getHandler().name;
    const controller = executionContext.getClass().name;
    const contextType = executionContext.getType<ContextType>();

    // Extract context information
    const contextInfo = this.extractContextInfo(executionContext, contextType);

    // Classify and extract error information
    const errorType = classifyError(error);
    const errorInfo = this.extractErrorInfo(error);

    // Record on current span
    this.recordSpanError(error);

    // Record error metric
    this.recordErrorMetric(error, contextType, errorType);

    // Structured log
    this.logger.error(`Error in ${controller}/${handler}`, undefined, {
      context_type: contextType,
      handler,
      controller,
      ...contextInfo,
      ...errorInfo,
    });
  }

  /**
   * Record error metric
   */
  private recordErrorMetric(
    error: unknown,
    contextType: ContextType,
    errorType: ErrorType,
  ): void {
    // Map context type to the format expected by MetricsService
    let metricsContext: 'http' | 'rabbitmq' | 'websocket' | 'other';
    switch (contextType) {
      case 'http':
        metricsContext = 'http';
        break;
      case 'rmq':
      case 'rpc':
        metricsContext = 'rabbitmq';
        break;
      case 'ws':
        metricsContext = 'websocket';
        break;
      default:
        metricsContext = 'other';
    }

    // Extract error code if available
    let errorCode: string | undefined;
    if (isPrismaKnownRequestError(error)) {
      errorCode = (error as { code: string }).code;
    } else if (isAxiosError(error)) {
      errorCode = String(error.response?.status || error.code || 'unknown');
    }

    this.metricsService.recordError({
      type: errorType,
      context: metricsContext,
      code: errorCode,
    });
  }

  /**
   * Extract information from execution context
   */
  private extractContextInfo(
    executionContext: ExecutionContext,
    contextType: ContextType,
  ): Record<string, unknown> {
    switch (contextType) {
      case 'http':
        return this.extractHttpContext(executionContext);
      case 'rmq':
        return this.extractRmqContext(executionContext);
      case 'ws':
        return this.extractWsContext(executionContext);
      default:
        return { context: 'unknown' };
    }
  }

  /**
   * Extract HTTP context
   */
  private extractHttpContext(executionContext: ExecutionContext): Record<string, unknown> {
    const request = executionContext.switchToHttp().getRequest();

    return {
      http: {
        method: request.method,
        url: request.url,
        path: request.path,
        query: request.query,
        params: request.params,
        user_id: request.user?.id || request.user?.sub,
      },
    };
  }

  /**
   * Extract RabbitMQ context
   */
  private extractRmqContext(executionContext: ExecutionContext): Record<string, unknown> {
    try {
      const rpcContext = executionContext.switchToRpc();
      const data = rpcContext.getData();
      const rmqContext = rpcContext.getContext();

      return {
        rabbitmq: {
          exchange: rmqContext?.fields?.exchange,
          routing_key: rmqContext?.fields?.routingKey,
          consumer_tag: rmqContext?.fields?.consumerTag,
          delivery_tag: rmqContext?.fields?.deliveryTag,
          // Don't log full message content for security
          message_keys: data ? Object.keys(data) : [],
        },
      };
    } catch {
      return { rabbitmq: { error: 'Failed to extract RMQ context' } };
    }
  }

  /**
   * Extract WebSocket context
   */
  private extractWsContext(executionContext: ExecutionContext): Record<string, unknown> {
    try {
      const client = executionContext.switchToWs().getClient<SocketLike>();
      const data = executionContext.switchToWs().getData();

      return {
        websocket: {
          client_id: client.id,
          event: executionContext.getHandler().name,
          // Don't log full content for security
          data_keys: data ? Object.keys(data) : [],
        },
      };
    } catch {
      return { websocket: { error: 'Failed to extract WS context' } };
    }
  }

  /**
   * Extract detailed error information based on type
   */
  private extractErrorInfo(error: unknown): Record<string, unknown> {
    const errorType = classifyError(error);

    switch (errorType) {
      case ErrorType.AXIOS:
        if (isAxiosError(error)) {
          return extractAxiosErrorInfo(error, this.sensitiveFields, this.maxBodySize);
        }
        break;

      case ErrorType.PRISMA_KNOWN:
        if (isPrismaKnownRequestError(error)) {
          return extractPrismaKnownErrorInfo(
            error as { code: string; meta?: Record<string, unknown>; message: string },
          );
        }
        break;

      case ErrorType.PRISMA_UNKNOWN:
        if (isPrismaUnknownRequestError(error)) {
          return extractPrismaUnknownErrorInfo(error as { message: string });
        }
        break;
    }

    return extractGenericErrorInfo(error);
  }

  /**
   * Record error on current OpenTelemetry span
   */
  private recordSpanError(error: unknown): void {
    const span = trace.getSpan(otelContext.active());

    if (!span) {
      return;
    }

    // Record exception
    if (error instanceof Error) {
      span.recordException(error);
    } else {
      span.recordException(new Error(String(error)));
    }

    // Mark span as error
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });

    // Add error attributes
    const errorType = classifyError(error);
    span.setAttribute('error.type', errorType);

    if (isAxiosError(error)) {
      span.setAttribute('http.status_code', error.response?.status || 0);
      span.setAttribute('http.method', error.config?.method?.toUpperCase() || 'UNKNOWN');
    }

    if (isPrismaKnownRequestError(error)) {
      const prismaError = error as { code: string };
      span.setAttribute('db.prisma.error_code', prismaError.code);
    }
  }
}
