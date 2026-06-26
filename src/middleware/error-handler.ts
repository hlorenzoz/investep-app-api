import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError, type ErrorCode, toErrorResponse } from "../lib/errors";
import { logError } from "../lib/log";
import type { AppBindings } from "../types/app";

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    default:
      return "INTERNAL_ERROR";
  }
}

/**
 * Manejador global de errores → respuesta con el formato único.
 * Nunca filtra stack traces ni datos sensibles al cliente (AGENTS.md §5).
 */
export const errorHandler: ErrorHandler<AppBindings> = (err, c) => {
  if (err instanceof AppError) {
    return c.json(toErrorResponse(err.code, err.message, err.details), err.status);
  }

  if (err instanceof HTTPException) {
    return c.json(toErrorResponse(statusToCode(err.status), err.message), err.status);
  }

  // Error inesperado: log mínimo (sin payloads ni credenciales) y respuesta genérica.
  logError("unhandled_error", { name: err instanceof Error ? err.name : "unknown" });
  return c.json(toErrorResponse("INTERNAL_ERROR", "Ocurrió un error inesperado."), 500);
};
