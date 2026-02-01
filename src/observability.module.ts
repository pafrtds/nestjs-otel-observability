import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
// Types
import {
  ObservabilityModuleOptions,
  OBSERVABILITY_OPTIONS,
  ObservabilityModuleAsyncOptions,
} from './types/observability.types';
// Logger
import { StructuredLoggerService } from './logger/structured-logger.service';
// Metrics
import { MetricsService } from './metrics/metrics.service';
// Interceptors
import { ObservabilityErrorInterceptor } from './interceptors/error/observability-error.interceptor';
import { RabbitMQTraceInterceptor } from './interceptors/rabbitmq/rabbitmq-trace.interceptor';
import { RabbitMQPublishInterceptor, AMQP_CONNECTION } from './interceptors/rabbitmq/rabbitmq-publish.interceptor';
import { WebSocketTraceInterceptor } from './interceptors/websocket/ws-trace.interceptor';
import { HttpMetricsInterceptor } from './interceptors/http/http-metrics.interceptor';

/**
 * NestJS Observability Module
 *
 * Provides comprehensive OpenTelemetry instrumentation for:
 * - HTTP (Express/Fastify)
 * - RabbitMQ (@golevelup/nestjs-rabbitmq)
 * - WebSocket (Socket.IO)
 * - Structured logs with trace context
 * - Metrics
 *
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [
 *     ObservabilityModule.forRoot({
 *       serviceName: 'my-service',
 *       serviceVersion: '1.0.0',
 *       environment: process.env.NODE_ENV,
 *       enableHttp: true,
 *       enableRabbit: true,
 *       enableWebSocket: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * IMPORTANT: The OpenTelemetry SDK must be initialized BEFORE loading modules.
 * Use initTracing() at the start of main.ts:
 *
 * ```typescript
 * // tracing.bootstrap.ts (create this file)
 * import { initTracing } from '@anfitriao/nestjs-otel-observability';
 *
 * initTracing({
 *   serviceName: process.env.SERVICE_NAME || 'my-service',
 *   serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
 *   environment: process.env.NODE_ENV || 'development',
 * });
 *
 * // main.ts
 * import './tracing.bootstrap'; // MUST be first import
 * import { NestFactory } from '@nestjs/core';
 * import { AppModule } from './app.module';
 * ```
 */
@Global()
@Module({})
export class ObservabilityModule {
  /**
   * Configure the observability module synchronously
   */
  static forRoot(options: ObservabilityModuleOptions): DynamicModule {
    const providers = this.createProviders(options);
    const interceptors = this.createInterceptors(options);

    return {
      module: ObservabilityModule,
      providers: [
        // Module options
        {
          provide: OBSERVABILITY_OPTIONS,
          useValue: options,
        },
        ...providers,
        ...interceptors,
      ],
      exports: [
        OBSERVABILITY_OPTIONS,
        StructuredLoggerService,
        MetricsService,
      ],
    };
  }

  /**
   * Configure the observability module asynchronously
   *
   * @example
   * ```typescript
   * ObservabilityModule.forRootAsync({
   *   imports: [ConfigModule],
   *   useFactory: (configService: ConfigService) => ({
   *     serviceName: configService.get('SERVICE_NAME'),
   *     environment: configService.get('NODE_ENV'),
   *   }),
   *   inject: [ConfigService],
   * })
   * ```
   */
  static forRootAsync(asyncOptions: ObservabilityModuleAsyncOptions): DynamicModule {
    return {
      module: ObservabilityModule,
      imports: asyncOptions.imports || [],
      providers: [
        // Async options provider
        {
          provide: OBSERVABILITY_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject || [],
        },
        // Base providers
        StructuredLoggerService,
        MetricsService,
        // RabbitMQ publish interceptor (monkey-patches AmqpConnection.publish)
        RabbitMQPublishInterceptor,
        // Global interceptors
        {
          provide: APP_INTERCEPTOR,
          useClass: ObservabilityErrorInterceptor,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpMetricsInterceptor,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: RabbitMQTraceInterceptor,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: WebSocketTraceInterceptor,
        },
      ],
      exports: [
        OBSERVABILITY_OPTIONS,
        StructuredLoggerService,
        MetricsService,
      ],
    };
  }

  /**
   * Configure the module with RabbitMQ AmqpConnection injection
   *
   * Use this when you want automatic trace context injection on RabbitMQ publish
   *
   * @example
   * ```typescript
   * ObservabilityModule.forRootWithRabbitMQ({
   *   serviceName: 'my-service',
   * }, AmqpConnection)
   * ```
   */
  static forRootWithRabbitMQ(
    options: ObservabilityModuleOptions,
    amqpConnectionToken: Type<unknown> | string | symbol,
  ): DynamicModule {
    const baseModule = this.forRoot(options);

    return {
      ...baseModule,
      providers: [
        ...(baseModule.providers || []),
        {
          provide: AMQP_CONNECTION,
          useExisting: amqpConnectionToken,
        },
      ],
    };
  }

  /**
   * Create base module providers
   */
  private static createProviders(options: ObservabilityModuleOptions): Provider[] {
    const providers: Provider[] = [
      StructuredLoggerService,
      MetricsService,
    ];

    // Add publish interceptor if RabbitMQ is enabled
    if (options.enableRabbit !== false) {
      providers.push(RabbitMQPublishInterceptor);
    }

    return providers;
  }

  /**
   * Create global interceptors based on options
   */
  private static createInterceptors(options: ObservabilityModuleOptions): Provider[] {
    const interceptors: Provider[] = [];

    // Error interceptor always active
    interceptors.push({
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityErrorInterceptor,
    });

    // HTTP metrics
    if (options.enableHttp !== false) {
      interceptors.push({
        provide: APP_INTERCEPTOR,
        useClass: HttpMetricsInterceptor,
      });
    }

    // RabbitMQ tracing
    if (options.enableRabbit !== false) {
      interceptors.push({
        provide: APP_INTERCEPTOR,
        useClass: RabbitMQTraceInterceptor,
      });
    }

    // WebSocket tracing
    if (options.enableWebSocket !== false) {
      interceptors.push({
        provide: APP_INTERCEPTOR,
        useClass: WebSocketTraceInterceptor,
      });
    }

    return interceptors;
  }
}
