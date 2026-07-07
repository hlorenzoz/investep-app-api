import { isAuthError } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { MUST_RESET_PASSWORD_KEY, resolveRole } from "../features/auth/metadata";
import { AppError } from "../lib/errors";
import { createSupabaseClient } from "../lib/supabase";
import type { AuthedBindings, AuthUser } from "../types/app";
import type { Env } from "../types/env";

const BEARER_PREFIX = "Bearer ";

/**
 * Extrae el token de un header `Authorization: Bearer <token>`.
 * Devuelve `null` si falta, si el esquema no es Bearer o si el token viene vacío.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/** Verifica un token y resuelve el usuario, o `null` si es inválido. */
export type TokenVerifier = (env: Env, token: string) => Promise<AuthUser | null>;

/** Construye el `AuthUser` a partir de la identidad verificada (claims o getUser). */
function buildAuthUser(id: string, email: string, appMetadata: Record<string, unknown>): AuthUser {
  const role = resolveRole(appMetadata);

  return {
    id,
    email,
    mustResetPassword: appMetadata[MUST_RESET_PASSWORD_KEY] === true,
    isAdmin: role === "admin",
    isManager: role === "manager",
    role,
  };
}

/**
 * Traduce un error de GoTrue a la semántica del middleware:
 * - 4xx (salvo 429) → `null`: GoTrue RECHAZÓ el token explícitamente → 401.
 * - Red caída / 5xx / 429 / desconocido → NO pudimos verificar. Devolver null sería un
 *   401 espurio (deslogueo ante un fallo de infra): 503 para que el cliente reintente.
 */
function rejectOrUnavailable(error: unknown): null {
  if (
    isAuthError(error) &&
    error.status != null &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    return null;
  }
  throw new AppError(
    "SERVICE_UNAVAILABLE",
    "No se pudo verificar la sesión. Probá de nuevo en unos segundos.",
    503,
    undefined,
    { cause: error },
  );
}

/** Path autoritativo por red: valida el token contra GoTrue (`auth.getUser`). */
async function verifyViaGetUser(
  supabase: ReturnType<typeof createSupabaseClient>,
  token: string,
): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    return rejectOrUnavailable(error);
  }
  if (!data.user?.email) {
    return null;
  }
  return buildAuthUser(
    data.user.id,
    data.user.email,
    (data.user.app_metadata ?? {}) as Record<string, unknown>,
  );
}

/**
 * Verificador real. Primero intenta `auth.getClaims(token)`:
 * - JWT firmado con clave ASIMÉTRICA → verificación 100% LOCAL (JWKS cacheado en memoria
 *   del isolate + WebCrypto): cero round-trips en el hot path. TRADEOFF ACEPTADO: en este
 *   path los claims quedan congelados hasta el `exp` del token (~1h máx.) — aplica a la
 *   revocación de sesiones (p. ej. tras change-password), a la democión de rol/privilegios
 *   (`requireAdmin` confía en el snapshot del JWT) y a `must_reset_password`. Mitigación:
 *   TTL corto del access token en Supabase.
 * - JWT HS256 (proyecto sin signing keys asimétricas) → getClaims delega internamente en
 *   `getUser` (red): mismo costo y semántica que el comportamiento histórico (estado fresco).
 * - Token NO decodable o expirado (`invalid_jwt`) → fallback al path legacy `getUser`:
 *   GoTrue es autoritativo y el resultado (401) es idéntico; solo cuesta una llamada de
 *   red para tokens basura/expirados, tráfico ya acotado por el rate limiting.
 * - getClaims puede LANZAR errores no-AuthError (p. ej. `SyntaxError` al decodificar un
 *   token base64url con contenido no-JSON): también van al fallback autoritativo — un
 *   token malformado debe terminar en 401, nunca en un 500.
 * El Worker nunca verifica firmas a mano ni guarda estado (AGENTS.md §3).
 */
export async function verifySupabaseToken(env: Env, token: string): Promise<AuthUser | null> {
  const supabase = createSupabaseClient(env);

  let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    claimsResult = await supabase.auth.getClaims(token);
  } catch {
    // Decodificación rota (no-JSON, alg exótico, etc.): GoTrue decide (→ 401 real).
    return verifyViaGetUser(supabase, token);
  }
  const { data, error } = claimsResult;

  if (!error && data?.claims) {
    const claims = data.claims as {
      sub?: string;
      email?: string;
      app_metadata?: Record<string, unknown>;
    };
    if (!claims.sub || !claims.email) {
      return null;
    }
    return buildAuthUser(claims.sub, claims.email, claims.app_metadata ?? {});
  }

  // `code === "invalid_jwt"` es el discriminador SEMÁNTICO estable de auth-js (el nombre
  // de la clase no tiene contrato de estabilidad y un rename lo rompería en silencio).
  if (isAuthError(error) && error.code === "invalid_jwt") {
    return verifyViaGetUser(supabase, token);
  }

  return rejectOrUnavailable(error);
}

/**
 * Factory del middleware de autenticación. El verificador es inyectable para
 * poder testear las ramas (falta de token / token inválido / token válido) sin
 * tocar el SDK de Supabase. En producción usa `verifySupabaseToken`.
 *
 * Lanza `AppError(UNAUTHORIZED, 401)` cuando no hay token o es inválido; el
 * error-handler global lo traduce al formato único de error.
 */
export function createAuthMiddleware(
  verify: TokenVerifier = verifySupabaseToken,
): MiddlewareHandler<AuthedBindings> {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Falta el token de autenticación.", 401);
    }

    const user = await verify(c.env, token);
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Token inválido o expirado.", 401);
    }

    c.set("user", user);
    // Guardamos el token crudo para las rutas que operan sobre la sesión (p. ej.
    // revocar sesiones tras un cambio de contraseña) sin re-parsear el header.
    c.set("accessToken", token);
    await next();
  };
}

/** Middleware listo para envolver rutas protegidas (validación real vía Supabase). */
export const requireAuth = createAuthMiddleware();
