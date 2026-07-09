import type { AppSupabaseClient } from "../../lib/supabase";

/**
 * Acceso canónico a la tabla `public.profiles`. Dueño ÚNICO de las reglas de perfil que
 * deben mantenerse en sincronía entre quienes lo escriben: el admin (users.service) y el
 * self-service (auth). Centraliza:
 *   - las columnas de perfil expuestas,
 *   - el mapeo snake_case → camelCase,
 *   - la coerción del string vacío a `null` (una sola representación de "sin dato"),
 *   - el upsert parcial que devuelve la fila fusionada en UN solo round-trip (`.select()`).
 *
 * Las funciones devuelven `{ data, error }` estilo supabase: la POLÍTICA de error queda en
 * el caller (auth/me es resiliente y loguea; users/get lanza 502; ambos upserts lanzan
 * vía throwPostgrestError), sin que el repositorio imponga una.
 */

export interface ProfileFields {
  fullName: string | null;
  phone: string | null;
  country: string | null;
}

/** Parche parcial de perfil (camelCase). Un `undefined` = "no tocar". */
export interface ProfilePatch {
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
}

/** Fila cruda de perfil (snake_case de PostgREST). */
interface ProfileRow {
  full_name: string | null;
  phone: string | null;
  country: string | null;
}

/** Mapper único snake_case → camelCase, tolerante a fila ausente (→ todo null). */
export function toProfileFields(row: ProfileRow | null | undefined): ProfileFields {
  return {
    fullName: row?.full_name ?? null,
    phone: row?.phone ?? null,
    country: row?.country ?? null,
  };
}

/** Lee el perfil de un usuario por id. Devuelve `{ data, error }`; el caller decide la política. */
export async function fetchProfile(admin: AppSupabaseClient, id: string) {
  return admin.from("profiles").select("full_name, phone, country").eq("id", id).maybeSingle();
}

/** Lee todos los perfiles (para listados admin), con el mismo set de columnas + id. */
export async function fetchAllProfiles(admin: AppSupabaseClient, limit: number) {
  return admin.from("profiles").select("id, full_name, phone, country").limit(limit);
}

/**
 * Upsert parcial del perfil: incluye SOLO las claves presentes en `patch` (un `undefined` =
 * "no tocar") y normaliza el string vacío a `null`. Devuelve la fila fusionada vía `.select()`
 * en UN solo round-trip. `{ data, error }` estilo supabase.
 */
export async function saveProfile(admin: AppSupabaseClient, id: string, patch: ProfilePatch) {
  const payload: {
    id: string;
    updated_at: string;
    full_name?: string | null;
    phone?: string | null;
    country?: string | null;
  } = { id, updated_at: new Date().toISOString() };

  // `|| null` colapsa "" a null; un valor real se conserva. fullName rara vez es "" (min 1),
  // pero se aplica la misma regla para una normalización uniforme.
  if (patch.fullName !== undefined) payload.full_name = patch.fullName || null;
  if (patch.phone !== undefined) payload.phone = patch.phone || null;
  if (patch.country !== undefined) payload.country = patch.country || null;

  return admin.from("profiles").upsert(payload).select("full_name, phone, country").maybeSingle();
}

/** True si el parche trae al menos un campo de perfil para escribir. */
export function hasProfileChanges(patch: ProfilePatch): boolean {
  return patch.fullName !== undefined || patch.phone !== undefined || patch.country !== undefined;
}
