/**
 * Lógica de decisión de la migración one-shot de `must_reset_password`
 * (`user_metadata` → `app_metadata`). Vive acá —como función pura testeable— en vez de
 * inline en `scripts/migrate-must-reset-flag.ts`, porque el gate de idempotencia es un
 * control de seguridad (un bug fail-open reabriría el agujero que el cambio cierra). El
 * script queda como wiring fino que la invoca.
 */
import { MUST_RESET_PASSWORD_KEY } from "./metadata";

/** Subconjunto del usuario de Supabase que la decisión necesita. */
export interface MigrationUser {
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
}

export type MustResetMigrationDecision =
  | { action: "skip" }
  | { action: "migrate"; flagValue: boolean };

/**
 * Decide qué hacer con un usuario en la migración del flag.
 *
 * - Si `app_metadata` YA tiene la clave → ya migrado → **skip**. Gatear acá (no por
 *   `user_metadata`) es robusto aunque GoTrue deje un residuo `null` en `user_metadata` al
 *   borrar: nunca recalculamos el flag desde ese null (que daría `false`) y por ende nunca
 *   apagamos por error el flag de un usuario ya migrado a `true`.
 * - Si `user_metadata` no tiene la clave → nada que migrar → **skip**.
 * - Si solo `user_metadata` la tiene → **migrate**, copiando el valor original (`=== true`).
 */
export function decideMustResetMigration(user: MigrationUser): MustResetMigrationDecision {
  const appMeta = user.app_metadata ?? {};
  const userMeta = user.user_metadata ?? {};

  if (MUST_RESET_PASSWORD_KEY in appMeta) return { action: "skip" };
  if (!(MUST_RESET_PASSWORD_KEY in userMeta)) return { action: "skip" };

  return { action: "migrate", flagValue: userMeta[MUST_RESET_PASSWORD_KEY] === true };
}
