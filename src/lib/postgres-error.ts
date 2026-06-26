import { AppError } from "./errors";

/**
 * ¿El fallo del data-layer es transitorio (outage) y conviene reintentar?
 * - status 0/undefined: el fetch falló (red caída).
 * - 5xx: Supabase/PostgREST caído.
 * - 429: throttling temporal.
 * El resto (4xx) es un problema genuino de la request → no reintentable.
 */
export function isTransientPostgrestError(status: number | undefined): boolean {
  return status === undefined || status === 0 || status === 429 || status >= 500;
}

/**
 * Traduce un error del data-layer al AppError correcto: 503 reintentable ante un outage
 * transitorio (consistente con el middleware de auth, que ya distingue 5xx→503), o 500
 * ante un error genuino. Nunca filtra el `cause` al cliente (AGENTS.md §5): viaja en
 * `options` (Error.cause) para diagnóstico server-side, jamás en `details`.
 */
export function throwPostgrestError(cause: unknown, userMessage: string, status?: number): never {
  if (isTransientPostgrestError(status)) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "El servicio no está disponible. Probá de nuevo en unos segundos.",
      503,
      undefined,
      { cause },
    );
  }
  throw new AppError("INTERNAL_ERROR", userMessage, 500, undefined, { cause });
}

/**
 * Traduce un error de la Admin API de Supabase Auth (GoTrue) al AppError correcto.
 * Extiende `throwPostgrestError` con el caso de input del usuario:
 * - 400 / 422 → 400 VALIDATION_ERROR con `validationMessage` (la propia política de GoTrue
 *   rechazó la contraseña: débil / igual a la anterior / leaked-password protection).
 * - transitorio (0/undefined/429/5xx) → 503 SERVICE_UNAVAILABLE.
 * - resto (4xx genuino no-input, p. ej. 404) → 500 INTERNAL_ERROR con `userMessage`.
 *
 * El `cause` viaja en options, nunca al cliente (§5). Helper compartido para que cada
 * endpoint de auth que llame a la Admin API mapee igual (no reinvente la política).
 */
export function throwSupabaseAuthError(
  cause: unknown,
  userMessage: string,
  validationMessage: string,
  status?: number,
): never {
  if (status === 400 || status === 422) {
    throw new AppError("VALIDATION_ERROR", validationMessage, 400, undefined, { cause });
  }
  throwPostgrestError(cause, userMessage, status);
}
