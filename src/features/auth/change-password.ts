/**
 * Servicio de cambio de contraseña iniciado por el usuario autenticado.
 *
 * Es el ÚNICO camino para apagar `must_reset_password`: cambia la contraseña y baja
 * el flag (que vive en `app_metadata`, solo escribible server-side) en UNA operación
 * admin. Tras el cambio revoca globalmente las sesiones del usuario para invalidar
 * tokens emitidos contra la contraseña vieja.
 *
 * El `admin` (service-role) se inyecta como objeto plano para testabilidad, igual
 * que `provisionUser`.
 */
import { AppError } from "../../lib/errors";
import { throwSupabaseAuthError } from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import { MUST_RESET_PASSWORD_KEY } from "./metadata";
import { validatePasswordPolicy } from "./password-policy";

/** Dependencias inyectadas en `changePassword`. */
export interface ChangePasswordDeps {
  /** Cliente Supabase inicializado con la service-role key. */
  admin: AppSupabaseClient;
}

/** Input aceptado por `changePassword`. */
export interface ChangePasswordInput {
  /** UUID del usuario autenticado (tomado del token, NUNCA del body). */
  userId: string;
  /** Email del usuario autenticado, para componer la respuesta sin re-leer Supabase. */
  email: string;
  /** Nueva contraseña elegida por el usuario. */
  newPassword: string;
  /** Access token del request; se usa para revocar globalmente las sesiones. */
  accessToken: string;
}

/** Resultado del cambio: misma forma que `/auth/me`, con el flag ya apagado. */
export interface ChangePasswordResult {
  user: {
    id: string;
    email: string;
    mustResetPassword: false;
  };
}

/**
 * Cambia la contraseña del usuario y apaga `must_reset_password` en `app_metadata`.
 *
 * @throws {AppError} 400 si la contraseña no cumple la política local o la rechaza GoTrue
 *   (4xx); 503 ante un outage transitorio de Supabase; 500 ante un error genuino inesperado.
 */
export async function changePassword(
  deps: ChangePasswordDeps,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const policyError = validatePasswordPolicy(input.newPassword);
  if (policyError) {
    // Política no cumplida → 400 (no se toca Supabase).
    throw new AppError("VALIDATION_ERROR", policyError, 400);
  }

  // Cambio de contraseña + apagado del flag en UNA operación admin. El flag vive en
  // `app_metadata` (solo escribible con la service-role key): el usuario no puede tocarlo.
  const { error } = await deps.admin.auth.admin.updateUserById(input.userId, {
    password: input.newPassword,
    app_metadata: { [MUST_RESET_PASSWORD_KEY]: false },
  });

  if (error) {
    // Mapeo compartido (lib/postgres-error): 400/422 de GoTrue (contraseña débil / igual a la
    // anterior / leaked-protection) → 400 accionable; transitorio → 503; resto → 500. El `cause`
    // viaja en options, nunca al cliente (§5).
    throwSupabaseAuthError(
      error,
      "No se pudo cambiar la contraseña.",
      "La contraseña no es válida o no cumple los requisitos de seguridad.",
      (error as { status?: number }).status,
    );
  }

  // Revocación de sesiones: best-effort. La contraseña YA cambió y el flag YA está
  // apagado; si la revocación falla no tiene sentido fallar todo el request (re-intentar
  // no ayuda). Se responde 200 igual.
  try {
    const { error: signOutError } = await deps.admin.auth.admin.signOut(
      input.accessToken,
      "global",
    );
    if (signOutError) throw signOutError;
  } catch (signOutErr) {
    // Evento de seguridad (§12): tokens emitidos contra la contraseña vieja podrían seguir
    // vivos. Logueamos userId + status para correlación (distinguir un 401 esperado de un
    // outage real); nunca el token ni el mensaje crudo (§5).
    const status = (signOutErr as { status?: number }).status ?? "desconocido";
    console.error(
      `change-password: revocación de sesiones falló (best-effort) userId=${input.userId} status=${status}`,
    );
  }

  return {
    user: {
      id: input.userId,
      email: input.email,
      mustResetPassword: false,
    },
  };
}
