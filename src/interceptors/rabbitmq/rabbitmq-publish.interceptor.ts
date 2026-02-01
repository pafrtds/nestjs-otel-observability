import { Injectable, OnModuleInit, Inject, Optional } from '@nestjs/common';
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_DESTINATION,
} from '@opentelemetry/semantic-conventions';
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  CustomSemanticAttributes,
} from '../../types/observability.types';

// Define AmqpConnection interface to avoid requiring @golevelup/nestjs-rabbitmq as a dependency
interface AmqpConnectionLike {
  publish<T>(
    exchange: string,
    routingKey: string,
    message: T,
    options?: Record<string, unknown>,
  ): Promise<boolean>;
}

// Injection token for AmqpConnection (from @golevelup/nestjs-rabbitmq)
export const AMQP_CONNECTION = 'AMQP_CONNECTION';

/**
 * Interceptor that monkey-patches AmqpConnection.publish
 * to automatically add trace context to all messages.
 *
 * This allows existing code to continue using amqpConnection.publish()
 * normally, without any modifications.
 *
 * The interceptor is initialized automatically when the observability module
 * is loaded.
 */
@Injectable()
export class RabbitMQPublishInterceptor implements OnModuleInit {
  private readonly tracer = trace.getTracer('rabbitmq-publisher');

  private readonly serviceName: string;

  private originalPublish: AmqpConnectionLike['publish'] | null = null;

  constructor(
    @Optional()
    @Inject(AMQP_CONNECTION)
    private readonly amqpConnection: AmqpConnectionLike | null,
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {
    this.serviceName = options?.serviceName || 'unknown-service';
  }

  onModuleInit(): void {
    if (!this.amqpConnection) {
      console.warn('[Observability] AmqpConnection not found, publish interceptor will not be applied');
      return;
    }

    this.interceptPublish();
    console.log('[Observability] RabbitMQ publish interceptor applied successfully');
  }

  /**
   * Apply monkey-patch to AmqpConnection.publish method
   */
  private interceptPublish(): void {
    if (!this.amqpConnection) return;

    // Store reference to original method
    this.originalPublish = this.amqpConnection.publish.bind(this.amqpConnection);

    // References to use inside closure
    const tracer = this.tracer;
    const serviceName = this.serviceName;
    const originalPublish = this.originalPublish;

    // Replace publish method
    (this.amqpConnection as AmqpConnectionLike).publish = async function <T>(
      exchange: string,
      routingKey: string,
      message: T,
      options?: Record<string, unknown>,
    ): Promise<boolean> {
      // Prepare headers
      const existingHeaders = (options?.headers as Record<string, string>) || {};
      const headers: Record<string, string> = { ...existingHeaders };

      // Create span for publish operation
      const span = tracer.startSpan(`${exchange} publish`, {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SEMATTRS_MESSAGING_SYSTEM]: 'rabbitmq',
          [SEMATTRS_MESSAGING_OPERATION]: 'publish',
          [SEMATTRS_MESSAGING_DESTINATION]: exchange,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_EXCHANGE]: exchange,
          [CustomSemanticAttributes.MESSAGING_RABBITMQ_ROUTING_KEY]: routingKey,
          'service.name': serviceName,
        },
      });

      try {
        // Inject trace context into headers
        const activeContext = trace.setSpan(context.active(), span);
        propagation.inject(activeContext, headers);

        // Call original method with enriched headers
        const result = await originalPublish(exchange, routingKey, message, {
          ...options,
          headers,
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        // Record error on span
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

        throw error;
      } finally {
        span.end();
      }
    };
  }

  /**
   * Restore original method (useful for testing)
   */
  restoreOriginal(): void {
    if (this.originalPublish && this.amqpConnection) {
      (this.amqpConnection as AmqpConnectionLike).publish = this.originalPublish;
    }
  }
}
