import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorResponse } from "../schemas/common";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/** Error de dominio con código estable y status HTTP. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: ContentfulStatusCode, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Construye el cuerpo de error con el formato único de la API. */
export function toErrorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}
