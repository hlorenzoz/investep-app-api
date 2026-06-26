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
