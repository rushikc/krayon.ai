export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "BAD_API_KEY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "QUOTA"
  | "MAX_TOKENS"
  | "SAFETY_BLOCKED"
  | "SCHEMA_INVALID"
  | "NOT_JSON"
  | "TIMEOUT"
  | "CANCELLED"
  | "UPSTREAM";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? statusForCode(code);
  }
}

export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
    case "BAD_API_KEY":
      return 401;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "BAD_REQUEST":
      return 400;
    case "SCHEMA_INVALID":
    case "NOT_JSON":
      return 422;
    case "RATE_LIMITED":
    case "QUOTA":
      return 429;
    case "CANCELLED":
      return 409;
    case "MAX_TOKENS":
    case "SAFETY_BLOCKED":
    case "TIMEOUT":
    case "UPSTREAM":
      return 502;
    default:
      return 500;
  }
}

export function httpErrorBody(error: unknown): { status: number; body: { code: string; message: string } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { code: "UPSTREAM", message } };
}
