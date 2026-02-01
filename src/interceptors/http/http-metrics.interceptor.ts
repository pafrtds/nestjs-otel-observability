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
import { MetricsService } from '../../metrics/metrics.service';
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
} from '../../types/observability.types';

// Define Request/Response interfaces to avoid requiring express as a dependency
interface RequestLike {
  method: string;
  path: string;
  url: string;
  route?: { path?: string };
}

interface ResponseLike {
  statusCode: number;
}

/**
 * Interceptor to collect HTTP metrics
 *
 * Automatically collects:
 * - Request count by method/route/status
 * - Request duration
 * - Error count
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options?: ObservabilityModuleOptions,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only process HTTP requests
    if (ctx.getType() !== 'http') {
      return next.handle();
    }

    const request = ctx.switchToHttp().getRequest<RequestLike>();
    const response = ctx.switchToHttp().getResponse<ResponseLike>();

    // Ignore health check routes
    if (this.shouldIgnore(request.path)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.recordMetrics(request, response.statusCode, startTime);
      }),
      catchError((error) => {
        // In case of error, try to get status code from error
        const statusCode = error.status || error.statusCode || 500;
        this.recordMetrics(request, statusCode, startTime);
        throw error;
      }),
    );
  }

  private recordMetrics(request: RequestLike, statusCode: number, startTime: number): void {
    const durationMs = Date.now() - startTime;
    const route = this.getRoute(request);

    this.metricsService.recordHttpRequest({
      method: request.method,
      route,
      statusCode,
      durationMs,
    });
  }

  /**
   * Get normalized route
   */
  private getRoute(request: RequestLike): string {
    // Try to get route from Express (with parameters)
    if (request.route?.path) {
      return request.route.path;
    }

    // Fallback to path
    return request.path;
  }

  /**
   * Check if route should be ignored
   */
  private shouldIgnore(path: string): boolean {
    const ignoredPaths = ['/health', '/healthz', '/ready', '/metrics', '/favicon.ico'];
    return ignoredPaths.some((ignored) => path.startsWith(ignored));
  }
}
