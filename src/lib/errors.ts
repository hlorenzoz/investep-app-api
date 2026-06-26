import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorResponse } from "../schemas/common";

/**
 * Códigos de error estables de la API. Fuente ÚNICA: de acá derivan el tipo `ErrorCode`
 * (server) y el `z.enum` del `ErrorSchema` (OpenAPI), para que el contrato no pueda divergir.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Error de dominio con código estable y status HTTP. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: ContentfulStatusCode,
    details?: unknown,
    // `cause` viaja en options (Error nativo). NO se expone al cliente (el error-handler
    // solo serializa code/message/details): sirve para diagnóstico server-side / dev.
    options?: ErrorOptions,
  ) {
    super(message, options);
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
