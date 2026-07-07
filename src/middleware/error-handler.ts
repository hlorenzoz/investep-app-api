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
    case 429:
      return "RATE_LIMITED";
    default:
      return "INTERNAL_ERROR";
  }
}

/**
 * Extrae del `cause` de un AppError SOLO campos value-free para diagnóstico: `code` y
 * `hint` (nombres de objeto de schema / SQLSTATE de PostgREST-Postgres, sin datos de
 * fila) o el `name` de un Error nativo. Deliberadamente NO se loguea ningún texto libre
 * (`message`/`details`): Postgres puede embeber valores de entrada o de fila ahí (p. ej.
 * "invalid input syntax for type integer: \"...\""), y el contrato de logs prohíbe datos
 * sensibles (§5, log.ts: "el llamador sanitiza antes de loguear").
 */
function causeContext(cause: unknown): { cause_code: string | null; cause_hint: string | null } {
  if (cause instanceof Error) {
    return { cause_code: cause.name, cause_hint: null };
  }
  if (typeof cause === "object" && cause !== null) {
    const c = cause as { code?: unknown; hint?: unknown };
    return {
      cause_code: typeof c.code === "string" ? c.code : null,
      cause_hint: typeof c.hint === "string" ? c.hint : null,
    };
  }
  return { cause_code: null, cause_hint: null };
}

/**
 * Manejador global de errores → respuesta con el formato único.
 * Nunca filtra stack traces ni datos sensibles al cliente (AGENTS.md §5).
 */
export const errorHandler: ErrorHandler<AppBindings> = (err, c) => {
  if (err instanceof AppError) {
    // Solo INTERNAL_ERROR (500, "no debería pasar") se loguea con su `cause` para
    // diagnóstico: es el caso ciego que hasta ahora no dejaba rastro. Los transitorios
    // (SERVICE_UNAVAILABLE/503) ya emiten eventos propios a nivel servicio y los 4xx
    // esperados no ensucian los logs. El `cause` NUNCA se expone al cliente: viaja solo
    // a la observabilidad del Worker (§5, §12).
    if (err.code === "INTERNAL_ERROR") {
      logError("app_error", {
        code: err.code,
        status: err.status,
        ...causeContext(err.cause),
      });
    }
    return c.json(toErrorResponse(err.code, err.message, err.details), err.status);
  }

  if (err instanceof HTTPException) {
    return c.json(toErrorResponse(statusToCode(err.status), err.message), err.status);
  }

  // Error inesperado: log mínimo (sin payloads ni credenciales) y respuesta genérica.
  logError("unhandled_error", { name: err instanceof Error ? err.name : "unknown" });
  return c.json(toErrorResponse("INTERNAL_ERROR", "Ocurrió un error inesperado."), 500);
};
