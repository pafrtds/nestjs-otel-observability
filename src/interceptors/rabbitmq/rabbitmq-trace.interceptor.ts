import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  Span,
} from '@opentelemetry/api';
import {
  MESSAGINGOPERATIONVALUES_PROCESS,
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_DESTINATION,
} from '@opentelemetry/semantic-conventions';
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  CustomSemanticAttributes,
} from '../../types/observability.types';
import { MetricsService } from '../../metrics/metrics.service';

/**
 * Interceptor to create spans for RabbitMQ consumers
 *
 * Extracts trace context from message headers and creates a span
 * for message processing, maintaining trace continuity.
 * Also records processing metrics.
 */
@Injectable()
export class RabbitMQTraceInterceptor implements NestInterceptor {
  private readonly tracer = trace.getTracer('rabbitmq-consumer');

  private readonly serviceName: string;

  constructor(
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {
    this.serviceName = options?.serviceName || 'unknown-service';
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check if it's RabbitMQ context
    if (!this.isRabbitMQContext(ctx)) {
      return next.handle();
    }

    const rmqContext = this.getRmqContext(ctx);

    if (!rmqContext) {
      return next.handle();
    }

    // Extract headers from message
    const headers = rmqContext.properties?.headers || {};

    // Extract trace context from headers
    const parentContext = propagation.extract(context.active(), headers);

    // Extract message information
    const exchange = rmqContext.fields?.exchange || 'unknown';
    const routingKey = rmqContext.fields?.routingKey || 'unknown';
    const queue = rmqContext.fields?.consumerTag?.split('-')[0] || 'unknown';
    const handlerName = ctx.getHandler().name;

    // Create span for processing
    const span = this.tracer.startSpan(
      `${exchange} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          [SEMATTRS_MESSAGING_SYSTEM]: 'rabbitmq',
          [SEMATTRS_MESSAGING_OPERATION]: MESSAGINGOPERATIONVALUES_PROCESS,
          [SEMATTRS_MESSAGING_DESTINATION]: exchange,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_EXCHANGE]: exchange,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_ROUTING_KEY]: routingKey,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_QUEUE]: queue,
          'code.function': handlerName,
          'service.name': this.serviceName,
        },
      },
      parentContext,
    );

    const startTime = Date.now();

    // Execute handler within span context
    return new Observable((observer) => {
      const activeContext = trace.setSpan(parentContext, span);

      context.with(activeContext, () => {
        next
          .handle()
          .pipe(
            tap(() => {
              this.endSpanSuccess(span);
              // Record success metric
              this.metricsService.recordRabbitMessage({
                exchange,
                routingKey,
                operation: 'consume',
                success: true,
                durationMs: Date.now() - startTime,
              });
            }),
            catchError((error) => {
              this.endSpanError(span, error);
              // Record error metric
              this.metricsService.recordRabbitMessage({
                exchange,
                routingKey,
                operation: 'consume',
                success: false,
                durationMs: Date.now() - startTime,
              });

              throw error;
            }),
          )
          .subscribe({
            next: (value) => observer.next(value),
            error: (err) => observer.error(err),
            complete: () => observer.complete(),
          });
      });
    });
  }

  /**
   * Check if context is RabbitMQ
   */
  private isRabbitMQContext(ctx: ExecutionContext): boolean {
    // NestJS marks RabbitMQ as 'rpc' or we check by arguments
    const contextType = ctx.getType<string>();

    if (contextType === 'rmq') {
      return true;
    }

    // Check if it's RPC context with RabbitMQ properties
    if (contextType === 'rpc') {
      const args = ctx.getArgs();
      return args && args[1] && args[1].properties;
    }

    return false;
  }

  /**
   * Get RMQ context
   */
  private getRmqContext(ctx: ExecutionContext): {
    properties?: { headers?: Record<string, string> };
    fields?: {
      exchange?: string;
      routingKey?: string;
      consumerTag?: string;
      deliveryTag?: number;
    };
  } | null {
    try {
      const args = ctx.getArgs();

      // @golevelup/nestjs-rabbitmq puts context in second argument
      if (args[1] && args[1].properties) {
        return args[1];
      }

      // Try via switchToRpc
      const rpcContext = ctx.switchToRpc().getContext();
      return rpcContext;
    } catch {
      return null;
    }
  }

  /**
   * End span with success
   */
  private endSpanSuccess(span: Span): void {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  /**
   * End span with error
   */
  private endSpanError(span: Span, error: unknown): void {
    if (error instanceof Error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error),
      });
    }

    span.end();
  }
}
