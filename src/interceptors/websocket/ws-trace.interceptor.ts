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
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  CustomSemanticAttributes,
} from '../../types/observability.types';
import { MetricsService } from '../../metrics/metrics.service';

// Define Socket interface to avoid requiring socket.io as a dependency
interface SocketLike {
  id: string;
  data?: { user?: { id?: string; sub?: string } };
  handshake?: {
    address?: string;
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  };
}

/**
 * Interceptor to create spans for WebSocket events
 *
 * Creates spans for each processed WebSocket event and maintains
 * trace continuity when context is provided.
 * Also records event metrics.
 */
@Injectable()
export class WebSocketTraceInterceptor implements NestInterceptor {
  private readonly tracer = trace.getTracer('websocket-gateway');

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
    // Check if it's WebSocket context
    if (ctx.getType() !== 'ws') {
      return next.handle();
    }

    const client = ctx.switchToWs().getClient<SocketLike>();
    const data = ctx.switchToWs().getData();
    const handlerName = ctx.getHandler().name;
    const controllerName = ctx.getClass().name;

    // Try to extract trace context
    const parentContext = this.extractTraceContext(client, data);

    // Create span for event
    const span = this.tracer.startSpan(
      `ws.${handlerName}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'messaging.system': 'socket.io',
          'messaging.operation.type': 'receive',
          [CustomSemanticAttributes.WS_EVENT_NAME]: handlerName,
          [CustomSemanticAttributes.WS_CLIENT_ID]: client.id,
          'code.function': handlerName,
          'code.namespace': controllerName,
          'service.name': this.serviceName,
          'network.transport': 'websocket',
          // Add connection info if available
          'client.address': client.handshake?.address,
          'user_agent.original': this.getHeader(client.handshake?.headers, 'user-agent'),
        },
      },
      parentContext,
    );

    // Add user info if available
    if (client.data?.user) {
      span.setAttribute('enduser.id', client.data.user.id || client.data.user.sub || 'unknown');
    }

    const startTime = Date.now();

    // Execute handler within span context
    return new Observable((observer) => {
      const activeContext = trace.setSpan(parentContext, span);

      context.with(activeContext, () => {
        next
          .handle()
          .pipe(
            tap((result) => {
              this.endSpanSuccess(span, result);
              // Record success metric
              this.metricsService.recordWsEvent({
                event: handlerName,
                success: true,
                durationMs: Date.now() - startTime,
              });
            }),
            catchError((error) => {
              this.endSpanError(span, error);
              // Record error metric
              this.metricsService.recordWsEvent({
                event: handlerName,
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
   * Extract trace context from WebSocket client
   *
   * Tries to extract from:
   * 1. Handshake headers
   * 2. _trace property in payload
   * 3. Handshake query params
   */
  private extractTraceContext(client: SocketLike, data: unknown): ReturnType<typeof context.active> {
    let carrier: Record<string, string> = {};

    // 1. Handshake headers
    if (client.handshake?.headers) {
      carrier = this.headersToCarrier(client.handshake.headers);
    }

    // 2. _trace property in payload (custom convention)
    if (data && typeof data === 'object' && '_trace' in data) {
      const traceData = (data as { _trace: Record<string, string> })._trace;
      carrier = { ...carrier, ...traceData };
    }

    // 3. Handshake query params
    const traceparent = this.getQueryParam(client.handshake?.query, 'traceparent');
    if (traceparent) {
      carrier['traceparent'] = traceparent;
    }

    const tracestate = this.getQueryParam(client.handshake?.query, 'tracestate');
    if (tracestate) {
      carrier['tracestate'] = tracestate;
    }

    // Extract context
    return propagation.extract(context.active(), carrier);
  }

  /**
   * Get header value as string
   */
  private getHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    key: string,
  ): string | undefined {
    if (!headers) return undefined;
    const value = headers[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return undefined;
  }

  /**
   * Get query param value as string
   */
  private getQueryParam(
    query: Record<string, string | string[] | undefined> | undefined,
    key: string,
  ): string | undefined {
    if (!query) return undefined;
    const value = query[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return undefined;
  }

  /**
   * Convert headers to carrier
   */
  private headersToCarrier(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const carrier: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        carrier[key.toLowerCase()] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        carrier[key.toLowerCase()] = value[0];
      }
    }

    return carrier;
  }

  /**
   * End span with success
   */
  private endSpanSuccess(span: Span, result: unknown): void {
    // Add info about response if it's an object
    if (result && typeof result === 'object') {
      span.setAttribute('ws.response.type', Array.isArray(result) ? 'array' : 'object');
    }

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

/**
 * Helper to inject trace context into a WebSocket response
 *
 * Useful when client needs to continue trace in subsequent calls
 *
 * @example
 * ```typescript
 * @SubscribeMessage('getData')
 * async handleGetData(@MessageBody() data: any) {
 *   const result = await this.service.getData(data);
 *   return injectTraceContext(result);
 * }
 * ```
 */
export function injectTraceContext<T extends Record<string, unknown>>(data: T): T & { _trace: Record<string, string> } {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  return {
    ...data,
    _trace: carrier,
  };
}
