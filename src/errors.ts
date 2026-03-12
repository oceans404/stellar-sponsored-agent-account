export abstract class ServiceError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  abstract readonly retryable: boolean;

  toJSON() {
    return {
      status: 'error' as const,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export class ValidationError extends ServiceError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_FAILED';
  readonly retryable = false;
}

export class RateLimitError extends ServiceError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';
  readonly retryable = true;
}

export class NotFoundError extends ServiceError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  readonly retryable = false;
}

export class HorizonError extends ServiceError {
  readonly statusCode = 502;
  readonly code = 'HORIZON_ERROR';
  readonly retryable = true;

  constructor(
    message: string,
    public readonly horizonResultCodes?: Record<string, string | string[]>,
  ) {
    super(message);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.horizonResultCodes && { result_codes: this.horizonResultCodes }),
    };
  }
}

export class UnavailableError extends ServiceError {
  readonly statusCode = 503;
  readonly code = 'SERVICE_UNAVAILABLE';
  readonly retryable = true;
}
