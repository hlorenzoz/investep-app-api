import { AppError } from "./errors";

/** SQLSTATE de Postgres para violación de restricción UNIQUE. */
const PG_UNIQUE_VIOLATION = "23505";

/** SQLSTATE de Postgres para violación de FOREIGN KEY (fila referenciada). */
const PG_FOREIGN_KEY_VIOLATION = "23503";

/** SQLSTATE de Postgres para violación de CHECK constraint. */
const PG_CHECK_VIOLATION = "23514";

/**
 * ¿El error del data-layer es una violación de UNIQUE (duplicado)? PostgREST
 * propaga el SQLSTATE de Postgres en `error.code`. Se usa para mapear un insert
 * duplicado (slug de broker, par único de plan) a `CONFLICT` (409) en vez del
 * 500 genérico. Helper compartido para que cada catálogo mapee igual (DRY).
 */
export function isUniqueViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION;
}

/**
 * ¿El error es una violación de FOREIGN KEY? Se usa al borrar una fila de catálogo
 * que todavía está referenciada (p. ej. un broker con asignaciones de usuarios):
 * se mapea a `CONFLICT` (409) en vez del 500 genérico.
 */
export function isForeignKeyViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === PG_FOREIGN_KEY_VIOLATION;
}

/**
 * ¿El error es una violación de CHECK constraint? Se usa cuando una regla de negocio
 * enforced a nivel DB (defense in depth, p. ej. price-o-amazon-url de `products`) rechaza
 * un insert/update que el refine de Zod no llegó a atajar (PATCH parcial que deja un estado
 * inválido). Se mapea a `VALIDATION_ERROR` (422) en vez del 500 genérico.
 */
export function isCheckViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === PG_CHECK_VIOLATION;
}

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
 * FK violation (23503) al insertar/upsertar una fila hija con un id o código que el admin pasó y
 * que no existe (un `locale` ausente en `locales`, una `feature` ausente en `investep_features`,
 * etc.): es input inválido → `VALIDATION_ERROR` (422), no un 500 genérico. El resto cae al mapeo
 * estándar de `throwPostgrestError`. Helper compartido para que cada catálogo con hijos por FK
 * mapee igual (DRY) — no reinvente la política por feature.
 */
export function throwForeignKeyAs422(
  cause: unknown,
  invalidRefMessage: string,
  fallbackMessage: string,
  status?: number,
): never {
  if (isForeignKeyViolation(cause)) {
    throw new AppError("VALIDATION_ERROR", invalidRefMessage, 422);
  }
  throwPostgrestError(cause, fallbackMessage, status);
}

/**
 * CHECK violation (23514) al insertar/actualizar una fila que rompe una regla de negocio
 * enforced en la DB (defense in depth): es input inválido → `VALIDATION_ERROR` (422), no un
 * 500 genérico. El resto cae al mapeo estándar de `throwPostgrestError`. Mismo patrón que
 * `throwForeignKeyAs422` (DRY, ver `products.service.ts`).
 */
export function throwCheckViolationAs422(
  cause: unknown,
  invalidMessage: string,
  fallbackMessage: string,
  status?: number,
): never {
  if (isCheckViolation(cause)) {
    throw new AppError("VALIDATION_ERROR", invalidMessage, 422);
  }
  throwPostgrestError(cause, fallbackMessage, status);
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
