/**
 * Clave en `user_metadata` de Supabase Auth que marca cambio de contraseña
 * obligatorio. Es ESCRITA por el aprovisionamiento (`user-provisioning.ts`) y
 * LEÍDA por el middleware de auth (`middleware/auth.ts`). Vive en un solo lugar
 * para que ambos lados no puedan divergir: un typo en una sola copia haría que
 * el flag fallara en silencio (fail-open).
 */
export const MUST_RESET_PASSWORD_KEY = "must_reset_password";
