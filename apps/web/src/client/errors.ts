import type { ApiErrorResponse } from '@open-design/contracts';

export interface NormalizedDaemonError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  retryable?: boolean;
  requestId?: string;
  taskId?: string;
}

export interface NormalizeDaemonErrorOptions {
  status?: number;
  fallbackMessage?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!isRecord(value)) return false;
  const error = value.error;
  return (
    isRecord(error) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

type LegacyDaemonErrorResponse = { error: string; code?: string };

function isLegacyErrorResponse(value: unknown): value is LegacyDaemonErrorResponse {
  return isRecord(value) && typeof value.error === 'string';
}

export function normalizeDaemonError(
  value: unknown,
  options: NormalizeDaemonErrorOptions = {},
): NormalizedDaemonError {
  if (isApiErrorResponse(value)) {
    return {
      code: value.error.code,
      message: value.error.message,
      status: options.status,
      details: value.error.details,
      retryable: value.error.retryable,
      requestId: value.error.requestId,
      taskId: value.error.taskId,
    };
  }

  if (isLegacyErrorResponse(value)) {
    return {
      code:
        'code' in value && typeof value.code === 'string'
          ? value.code
          : 'INTERNAL_ERROR',
      message: value.error,
      status: options.status,
    };
  }

  if (value instanceof Error) {
    return {
      code: value.name || 'INTERNAL_ERROR',
      message: value.message || options.fallbackMessage || 'Daemon request failed',
      status: options.status,
    };
  }

  if (typeof value === 'string' && value.trim()) {
    return {
      code: 'INTERNAL_ERROR',
      message: value,
      status: options.status,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: options.fallbackMessage || 'Daemon request failed',
    status: options.status,
  };
}
