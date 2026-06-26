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
