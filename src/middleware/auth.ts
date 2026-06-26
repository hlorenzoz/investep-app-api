import { isAuthApiError } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { MUST_RESET_PASSWORD_KEY } from "../features/auth/metadata";
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

/**
 * Verificador real: valida el JWT contra Supabase Auth con la anon key
 * (`supabase.auth.getUser`). El Worker NUNCA verifica firmas a mano ni guarda
 * estado: delega la validación a Supabase (AGENTS.md §3). Es un round-trip HTTP
 * por request protegida — aceptable para el primer endpoint; si la latencia
 * pesa, migrar a verificación local de JWT (JWKS) más adelante.
 */
export async function verifySupabaseToken(env: Env, token: string): Promise<AuthUser | null> {
  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error) {
    // GoTrue RECHAZÓ el token explícitamente (4xx, salvo rate-limit) → no autorizado.
    if (
      isAuthApiError(error) &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
      return null;
    }
    // Red caída / 5xx / 429 / error desconocido → NO pudimos verificar. Devolver null
    // sería un 401 espurio (deslogueo ante un fallo de infra): 503 para que el cliente reintente.
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "No se pudo verificar la sesión. Probá de nuevo en unos segundos.",
      503,
      undefined,
      { cause: error },
    );
  }

  if (!data.user?.email) {
    return null;
  }

  // El flag vive en `app_metadata` (solo escribible server-side con la service-role key),
  // NO en `user_metadata` (que el propio usuario puede escribir desde el browser). Es un
  // control de seguridad: leerlo de user_metadata permitiría apagarlo sin cambiar la clave.
  const appMetadata = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  return {
    id: data.user.id,
    email: data.user.email,
    mustResetPassword: appMetadata[MUST_RESET_PASSWORD_KEY] === true,
  };
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
