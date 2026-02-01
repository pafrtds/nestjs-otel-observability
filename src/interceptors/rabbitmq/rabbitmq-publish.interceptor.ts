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

// Injection token for AmqpConnection (from @golevelup/nestjs-rabbitmq)
export const AMQP_CONNECTION = 'AMQP_CONNECTION';

// Flag to prevent applying the patch multiple times
let isPatched = false;

let originalPublish: ((...args: unknown[]) => Promise<boolean>) | null = null;

// We need to dynamically import AmqpConnection to avoid requiring the dependency
let AmqpConnectionClass: { prototype: { publish: (...args: unknown[]) => Promise<boolean> } } | null = null;

/**
 * Interceptor that monkey-patches AmqpConnection.prototype.publish
 * to automatically add trace context to all messages.
 *
 * This allows existing code to continue using amqpConnection.publish()
 * normally, without any modifications.
 *
 * The patch is applied to the prototype, so it works for ALL instances
 * of AmqpConnection, regardless of where they are created.
 */
@Injectable()
export class RabbitMQPublishInterceptor implements OnModuleInit {
  private readonly tracer = trace.getTracer('rabbitmq-publisher');

  private readonly serviceName: string;

  constructor(
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {
    this.serviceName = options?.serviceName || process.env.SERVICE_NAME || 'unknown-service';
  }

  onModuleInit(): void {
    this.interceptPublish();
  }

  /**
   * Apply monkey-patch to AmqpConnection prototype
   * This intercepts ALL publish() calls from all instances
   */
  private interceptPublish(): void {
    // Prevent applying the patch multiple times
    if (isPatched) {
      return;
    }

    // Try to dynamically load AmqpConnection
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rabbitModule = require('@golevelup/nestjs-rabbitmq');

      AmqpConnectionClass = rabbitModule.AmqpConnection;
    } catch {
      console.warn(
        '[Observability] @golevelup/nestjs-rabbitmq not found, RabbitMQ publish interceptor will not be applied',
      );
      return;
    }

    if (!AmqpConnectionClass) {
      return;
    }

    // Store reference to original prototype method
    originalPublish = AmqpConnectionClass.prototype.publish;

    // References for use inside closure
    const tracer = this.tracer;
    const serviceName = this.serviceName;

    // Replace the publish method on the prototype
    AmqpConnectionClass.prototype.publish = async function <T>(
      this: unknown,
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
        // Use .call() to maintain correct 'this' context
        const result = await originalPublish!.call(this, exchange, routingKey, message, {
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

    isPatched = true;
    console.log('[Observability] RabbitMQ publish interceptor applied successfully (prototype patch)');
  }

  /**
   * Restore original method (useful for testing)
   */
  static restoreOriginal(): void {
    if (originalPublish && AmqpConnectionClass) {
      AmqpConnectionClass.prototype.publish = originalPublish;
      isPatched = false;
      originalPublish = null;
    }
  }
}
