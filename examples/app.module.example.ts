/**
 * App Module Example
 *
 * This example shows how to configure the ObservabilityModule
 * in your NestJS application.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ObservabilityModule } from '@anfitriao/nestjs-otel-observability';

@Module({
  imports: [
    ConfigModule.forRoot(),

    // Option 1: Synchronous configuration
    // ObservabilityModule.forRoot({
    //   serviceName: 'my-service',
    //   serviceVersion: '1.0.0',
    //   environment: 'production',
    //   enableHttp: true,
    //   enableRabbit: true,
    //   enableWebSocket: true,
    // }),

    // Option 2: Async configuration with ConfigService (recommended)
    ObservabilityModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        serviceName: configService.get<string>('SERVICE_NAME', 'my-service'),
        serviceVersion: configService.get<string>('SERVICE_VERSION', '1.0.0'),
        environment: configService.get<string>('NODE_ENV', 'development'),

        // OTLP endpoints
        otlpTraceEndpoint: configService.get<string>(
          'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
          'http://otel-collector:4318/v1/traces',
        ),
        otlpMetricsEndpoint: configService.get<string>(
          'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
          'http://otel-collector:4318/v1/metrics',
        ),
        otlpLogsEndpoint: configService.get<string>(
          'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
          'http://otel-collector:4318/v1/logs',
        ),

        // Feature toggles
        enableHttp: true,
        enableRabbit: true,
        enableWebSocket: true,
        enableMetrics: configService.get<string>('OTEL_METRICS_ENABLED') !== 'false',

        // Log configuration
        enableOtlpLogs: configService.get<string>('OTEL_LOGS_ENABLED') !== 'false',
        enableConsoleLogs: configService.get<string>('OTEL_CONSOLE_LOGS_ENABLED') !== 'false',
        logLevel: configService.get<'debug' | 'info' | 'warn' | 'error'>('LOG_LEVEL', 'info'),

        // Security
        sensitiveFields: [
          'password',
          'token',
          'authorization',
          'secret',
          'key',
          'apikey',
          'credit_card',
        ],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
