/**
 * Clave en `app_metadata` de Supabase Auth que marca cambio de contraseña
 * obligatorio. Vive en `app_metadata` (solo escribible server-side con la
 * service-role key), NO en `user_metadata` (escribible por el propio usuario):
 * es un control de seguridad. Es ESCRITA por el aprovisionamiento
 * (`user-provisioning.ts`), por `change-password.ts` (apagado) y por el script
 * de migración; LEÍDA por el middleware de auth (`middleware/auth.ts`). Vive en
 * un solo lugar para que todos los lados no puedan divergir: un typo en una sola
 * copia haría que el flag fallara en silencio (fail-open).
 */
export const MUST_RESET_PASSWORD_KEY = "must_reset_password";

/**
 * Clave en `app_metadata` que marca a un usuario como administrador. Mismo
 * mecanismo de seguridad que `MUST_RESET_PASSWORD_KEY`: vive en `app_metadata`
 * (solo escribible server-side con la service-role key), NO en `user_metadata`
 * (que el propio usuario podría escribir desde el browser y auto-otorgarse admin).
 * Es LEÍDA por el middleware de auth (`middleware/auth.ts`) y consumida por
 * `requireAdmin` (`middleware/admin.ts`) para proteger el CRUD de catálogos.
 * Se ESCRIBE manualmente con service-role (`admin.auth.admin.updateUserById`),
 * no hay endpoint que la otorgue (evita escalada de privilegios).
 */
export const IS_ADMIN_KEY = "is_admin";

/** Roles reconocidos por la API. */
export type AppRole = "admin" | "manager" | "user";

/**
 * Resuelve el rol desde `app_metadata` de Supabase Auth con la precedencia
 * canónica: campo `role` explícito → flag legacy `is_admin` → flag legacy
 * `is_manager` → `user`. Es lógica de seguridad y vive en UN solo lugar:
 * la consumen el middleware de auth (`middleware/auth.ts`) y el listado
 * admin (`features/users/users.service.ts`); dos copias podrían divergir
 * silenciosamente sobre el rol efectivo de un usuario.
 */
export function resolveRole(appMetadata: Record<string, unknown>): AppRole {
  const rawRole = appMetadata.role as string | undefined;
  if (rawRole === "admin" || rawRole === "manager" || rawRole === "user") {
    return rawRole;
  }
  if (appMetadata[IS_ADMIN_KEY] === true) {
    return "admin";
  }
  if (appMetadata.is_manager === true) {
    return "manager";
  }
  return "user";
}
