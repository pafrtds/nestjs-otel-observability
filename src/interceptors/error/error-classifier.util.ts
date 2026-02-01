import { ErrorType } from '../../types/observability.types';
import { DEFAULT_SENSITIVE_FIELDS, DEFAULT_MAX_BODY_LOG_SIZE } from '../../constants';

// Define AxiosError interface to avoid requiring axios as a dependency
interface AxiosErrorLike {
  isAxiosError: boolean;
  config?: {
    method?: string;
    url?: string;
    baseURL?: string;
    timeout?: number;
    headers?: Record<string, unknown>;
    data?: unknown;
  };
  response?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, unknown>;
    data?: unknown;
  };
  code?: string;
  message: string;
}

/**
 * Check if error is an Axios error
 */
export function isAxiosError(error: unknown): error is AxiosErrorLike {
  return !!(error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError);
}

/**
 * Check if error is a known Prisma error
 */
export function isPrismaKnownRequestError(error: unknown): boolean {
  return !!(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'clientVersion' in error &&
    'name' in error &&
    (error as { name: string }).name === 'PrismaClientKnownRequestError'
  );
}

/**
 * Check if error is an unknown Prisma error
 */
export function isPrismaUnknownRequestError(error: unknown): boolean {
  return !!(
    error &&
    typeof error === 'object' &&
    'clientVersion' in error &&
    'name' in error &&
    (error as { name: string }).name === 'PrismaClientUnknownRequestError'
  );
}

/**
 * Check if error is a Prisma validation error
 */
export function isPrismaValidationError(error: unknown): boolean {
  return !!(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: string }).name === 'PrismaClientValidationError'
  );
}

/**
 * Classify the error type
 */
export function classifyError(error: unknown): ErrorType {
  if (isAxiosError(error)) {
    return ErrorType.AXIOS;
  }

  if (isPrismaKnownRequestError(error)) {
    return ErrorType.PRISMA_KNOWN;
  }

  if (isPrismaUnknownRequestError(error)) {
    return ErrorType.PRISMA_UNKNOWN;
  }

  if (isPrismaValidationError(error)) {
    return ErrorType.PRISMA_VALIDATION;
  }

  return ErrorType.GENERIC;
}

/**
 * Mask sensitive headers
 */
export function maskHeaders(
  headers: Record<string, unknown> | undefined,
  sensitiveFields: string[] = DEFAULT_SENSITIVE_FIELDS,
): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()));
    masked[key] = isSensitive ? '[REDACTED]' : value;
  }

  return masked;
}

/**
 * Truncate body to avoid large logs
 */
export function truncateBody(
  body: unknown,
  maxSize: number = DEFAULT_MAX_BODY_LOG_SIZE,
): unknown {
  if (body === undefined || body === null) {
    return undefined;
  }

  let stringified: string;

  try {
    stringified = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    return '[SERIALIZATION_ERROR]';
  }

  if (stringified.length <= maxSize) {
    try {
      return typeof body === 'string' ? body : JSON.parse(stringified);
    } catch {
      return stringified;
    }
  }

  return `${stringified.substring(0, maxSize)}... [TRUNCATED - total: ${stringified.length} bytes]`;
}

/**
 * Extract detailed information from an Axios error
 */
export function extractAxiosErrorInfo(
  error: AxiosErrorLike,
  sensitiveFields: string[] = DEFAULT_SENSITIVE_FIELDS,
  maxBodySize: number = DEFAULT_MAX_BODY_LOG_SIZE,
): Record<string, unknown> {
  const { config, response, code, message } = error;

  return {
    error_type: ErrorType.AXIOS,
    error_code: code,
    error_message: message,
    http: {
      method: config?.method?.toUpperCase(),
      url: config?.url,
      base_url: config?.baseURL,
      timeout: config?.timeout,
      status_code: response?.status,
      status_text: response?.statusText,
    },
    request: {
      headers: maskHeaders(config?.headers as Record<string, unknown>, sensitiveFields),
      body: truncateBody(config?.data, maxBodySize),
    },
    response: {
      headers: maskHeaders(response?.headers as Record<string, unknown>, sensitiveFields),
      body: truncateBody(response?.data, maxBodySize),
    },
  };
}

/**
 * Extract detailed information from a known Prisma error
 */
export function extractPrismaKnownErrorInfo(error: {
  code: string;
  meta?: Record<string, unknown>;
  message: string;
}): Record<string, unknown> {
  // Extract information without sensitive data
  const meta = error.meta || {};

  // Remove specific values that may contain sensitive data
  const safeMeta: Record<string, unknown> = {};

  if (meta.modelName) {
    safeMeta.model = meta.modelName;
  }

  if (meta.target) {
    safeMeta.field = meta.target;
  }

  if (meta.constraint) {
    safeMeta.constraint = meta.constraint;
  }

  return {
    error_type: ErrorType.PRISMA_KNOWN,
    error_code: error.code,
    error_message: sanitizePrismaMessage(error.message),
    prisma: safeMeta,
  };
}

/**
 * Extract detailed information from an unknown Prisma error
 */
export function extractPrismaUnknownErrorInfo(error: { message: string }): Record<string, unknown> {
  return {
    error_type: ErrorType.PRISMA_UNKNOWN,
    error_message: sanitizePrismaMessage(error.message),
  };
}

/**
 * Extract information from a generic error
 */
export function extractGenericErrorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error_type: ErrorType.GENERIC,
      error_name: error.name,
      error_message: error.message,
      stack_trace: error.stack,
    };
  }

  return {
    error_type: ErrorType.GENERIC,
    error_message: String(error),
  };
}

/**
 * Sanitize Prisma messages removing sensitive data
 * Prisma may include field values in error messages
 */
function sanitizePrismaMessage(message: string): string {
  // Remove possible values in quotes that may be sensitive data
  // But keep the message structure
  return message
    .replace(/`[^`]+`/g, '`[VALUE]`')
    .replace(/"[^"]{50,}"/g, '"[LONG_VALUE]"');
}
