# @pafrtds/nestjs-otel-observability

A comprehensive OpenTelemetry observability module for NestJS applications. Provides automatic distributed tracing, structured logging, and metrics collection with minimal configuration.

## Features

- **Distributed Tracing**: Automatic trace propagation across HTTP, RabbitMQ, and WebSocket
- **Structured Logging**: JSON logs with automatic trace context enrichment (trace_id, span_id)
- **Metrics Collection**: HTTP request duration, error counts, RabbitMQ processing, WebSocket events
- **Global Error Handling**: Automatic error classification (Axios, Prisma, generic) with detailed logging
- **RabbitMQ Integration**: Transparent trace context injection/extraction for @golevelup/nestjs-rabbitmq
- **WebSocket Support**: Full tracing for Socket.IO events
- **OTLP Export**: Send telemetry to OpenTelemetry Collector (compatible with Grafana, Jaeger, etc.)
- **Resilience**: Graceful degradation if OTLP endpoint is unavailable

## Requirements

- Node.js >= 18.0.0
- NestJS >= 10.0.0

## Installation

```bash
npm install @pafrtds/nestjs-otel-observability
```

### Peer Dependencies

The following packages are required as peer dependencies:

```bash
npm install @nestjs/common @nestjs/core reflect-metadata rxjs
```

### Optional Dependencies

For RabbitMQ tracing:
```bash
npm install @golevelup/nestjs-rabbitmq
```

For WebSocket tracing:
```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
```

## Quick Start

### 1. Create the tracing bootstrap file

Create `src/tracing.bootstrap.ts`:

```typescript
import { initTracing } from '@pafrtds/nestjs-otel-observability';

initTracing({
  serviceName: process.env.SERVICE_NAME || 'my-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  
  // OTLP endpoints (optional, defaults to localhost:4318)
  otlpTraceEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  otlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  otlpLogsEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
  
  // Feature toggles
  enableMetrics: true,
  enableOtlpLogs: true,
  enableConsoleLogs: true,
});
```

### 2. Import tracing bootstrap FIRST in main.ts

```typescript
import './tracing.bootstrap'; // MUST be the first import!

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLoggerService } from '@pafrtds/nestjs-otel-observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Optionally use the structured logger
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);
  
  await app.listen(3000);
}

bootstrap();
```

### 3. Import the module in AppModule

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ObservabilityModule } from '@pafrtds/nestjs-otel-observability';

@Module({
  imports: [
    ConfigModule.forRoot(),
    
    ObservabilityModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        serviceName: configService.get('SERVICE_NAME', 'my-service'),
        environment: configService.get('NODE_ENV', 'development'),
        enableHttp: true,
        enableRabbit: true,
        enableWebSocket: true,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceName` | `string` | **required** | Name of the service |
| `serviceVersion` | `string` | `'1.0.0'` | Version of the service |
| `environment` | `string` | `'development'` | Deployment environment |
| `otlpTraceEndpoint` | `string` | `http://localhost:4318/v1/traces` | OTLP traces endpoint |
| `otlpMetricsEndpoint` | `string` | `http://localhost:4318/v1/metrics` | OTLP metrics endpoint |
| `otlpLogsEndpoint` | `string` | `http://localhost:4318/v1/logs` | OTLP logs endpoint |
| `enableHttp` | `boolean` | `true` | Enable HTTP instrumentation |
| `enableRabbit` | `boolean` | `true` | Enable RabbitMQ instrumentation |
| `enableWebSocket` | `boolean` | `true` | Enable WebSocket instrumentation |
| `enableMetrics` | `boolean` | `true` | Enable metrics collection |
| `enableOtlpLogs` | `boolean` | `true` | Send logs to OTLP endpoint |
| `enableConsoleLogs` | `boolean` | `true` | Output logs to console |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `'info'` | Minimum log level |
| `sensitiveFields` | `string[]` | `['password', 'token', ...]` | Fields to mask in logs |
| `maxBodyLogSize` | `number` | `10000` | Maximum body size to log (bytes) |
| `metricsExportIntervalMs` | `number` | `15000` | Metrics export interval |
| `debug` | `boolean` | `false` | Enable verbose OTel logging |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SERVICE_NAME` | Service name for telemetry |
| `SERVICE_VERSION` | Service version |
| `NODE_ENV` | Environment (development/production) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP traces endpoint |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | OTLP metrics endpoint |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | OTLP logs endpoint |
| `OTEL_LOGS_ENABLED` | Enable OTLP logs (`'true'`/`'false'`) |
| `OTEL_CONSOLE_LOGS_ENABLED` | Enable console logs (`'true'`/`'false'`) |
| `OTEL_METRICS_ENABLED` | Enable metrics (`'true'`/`'false'`) |
| `OTEL_METRICS_EXPORT_INTERVAL_MS` | Metrics export interval |
| `OTEL_DEBUG` | Enable debug mode (`'true'`/`'false'`) |

## Usage

### Using the Structured Logger

```typescript
import { Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '@pafrtds/nestjs-otel-observability';

@Injectable()
export class MyService {
  constructor(private readonly logger: StructuredLoggerService) {
    this.logger.setContext('MyService');
  }

  doSomething() {
    // Basic logging
    this.logger.log('Operation started');
    this.logger.debug('Debug information', { userId: 123 });
    this.logger.warn('Warning message');
    this.logger.error('Error occurred', errorStack);

    // With metadata
    this.logger.log('User action', {
      action: 'purchase',
      amount: 99.99,
      productId: 'ABC123',
    });
  }
}
```

### Using Metrics

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '@pafrtds/nestjs-otel-observability';

@Injectable()
export class MyService {
  constructor(private readonly metrics: MetricsService) {}

  // Create custom metrics
  private orderCounter = this.metrics.createCounter(
    'orders_total',
    'Total number of orders processed',
  );

  processOrder(order: Order) {
    // Record custom metric
    this.orderCounter.add(1, {
      status: order.status,
      payment_method: order.paymentMethod,
    });
  }
}
```

### Getting Trace Context

```typescript
import {
  getCurrentTraceId,
  getCurrentSpanId,
  getTraceContextInfo,
} from '@pafrtds/nestjs-otel-observability';

// Get current trace ID (useful for logging or correlation)
const traceId = getCurrentTraceId();

// Get all trace context info
const { traceId, spanId, traceFlags } = getTraceContextInfo();
```

### WebSocket Trace Context Injection

```typescript
import { SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { injectTraceContext } from '@pafrtds/nestjs-otel-observability';

@SubscribeMessage('getData')
async handleGetData(@MessageBody() data: any) {
  const result = await this.service.getData(data);
  
  // Include trace context in response for client-side correlation
  return injectTraceContext(result);
}
```

## OpenTelemetry Collector Configuration

Example `otel-collector-config.yaml`:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write
    resource_to_telemetry_conversion:
      enabled: true

  loki:
    endpoint: http://loki:3100/loki/api/v1/push
    labels:
      resource:
        service.name: "service_name"
        deployment.environment: "environment"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]
    
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]
    
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
```

## Collected Metrics

### HTTP Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `http_requests_total` | Counter | Total HTTP requests | `method`, `route`, `status_code` |
| `http_errors_total` | Counter | Total HTTP errors (4xx/5xx) | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | Request duration | `method`, `route`, `status_code` |

### RabbitMQ Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `rabbitmq_messages_total` | Counter | Total messages processed | `exchange`, `routing_key`, `operation` |
| `rabbitmq_errors_total` | Counter | Total processing errors | `exchange`, `routing_key`, `operation` |
| `rabbitmq_processing_duration_seconds` | Histogram | Processing duration | `exchange`, `routing_key`, `operation` |

### WebSocket Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `websocket_events_total` | Counter | Total events processed | `event` |
| `websocket_errors_total` | Counter | Total event errors | `event` |
| `websocket_event_duration_seconds` | Histogram | Event processing duration | `event` |

### Error Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `errors_total` | Counter | Total errors by type | `error_type`, `context`, `error_code` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     NestJS Application                          │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    HTTP     │  │  RabbitMQ   │  │      WebSocket          │  │
│  │  Requests   │  │  Messages   │  │       Events            │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         ▼                ▼                      ▼                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ObservabilityModule                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │                 Interceptors                        │  │   │
│  │  │  • HttpMetricsInterceptor                          │  │   │
│  │  │  • RabbitMQTraceInterceptor                        │  │   │
│  │  │  • RabbitMQPublishInterceptor (monkey-patch)       │  │   │
│  │  │  • WebSocketTraceInterceptor                       │  │   │
│  │  │  • ObservabilityErrorInterceptor                   │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │                   Services                          │  │   │
│  │  │  • StructuredLoggerService                         │  │   │
│  │  │  • MetricsService                                  │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │   OpenTelemetry Collector │
                │   (OTLP HTTP :4318)       │
                └────────────┬─────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
     ┌─────────┐       ┌─────────┐       ┌─────────┐
     │  Tempo  │       │Prometheus│       │  Loki   │
     │ Traces  │       │ Metrics │       │  Logs   │
     └─────────┘       └─────────┘       └─────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                             ▼
                      ┌─────────────┐
                      │   Grafana   │
                      └─────────────┘
```

## Error Classification

The module automatically classifies errors into the following types:

| Type | Description | Additional Info |
|------|-------------|-----------------|
| `AxiosError` | HTTP client errors | URL, status code, method, headers |
| `PrismaClientKnownRequestError` | Prisma constraint violations | Error code, model, field |
| `PrismaClientUnknownRequestError` | Prisma unknown errors | Sanitized message |
| `PrismaClientValidationError` | Prisma validation errors | Sanitized message |
| `Error` | Generic JavaScript errors | Name, message, stack trace |

## Security

The module includes built-in security features:

- **Sensitive field masking**: Passwords, tokens, and other sensitive fields are automatically redacted in logs
- **Body truncation**: Large request/response bodies are truncated to prevent excessive logging
- **Prisma message sanitization**: Values in Prisma error messages are sanitized to prevent data leakage

Default sensitive fields:
- `password`, `token`, `authorization`, `secret`, `key`, `apikey`
- `api_key`, `api-key`, `bearer`, `credential`, `private`
- `cpf`, `cnpj`, `ssn`, `credit_card`, `card_number`

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
