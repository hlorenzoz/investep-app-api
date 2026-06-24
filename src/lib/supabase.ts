import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import type { Env } from "../types/env";

/** Cliente tipado contra el schema (tipos generados con `just supabase-types`). */
export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * Cliente Supabase para contexto de usuario (anon key). Se crea por request:
 * Workers no mantiene estado entre invocaciones y usamos el cliente HTTP/REST,
 * no conexiones TCP a Postgres (AGENTS.md §3).
 */
export function createSupabaseClient(env: Env): AppSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Cliente Supabase con service-role key. SOLO server-side.
 * Nunca exponer esta key ni sus respuestas crudas al cliente (AGENTS.md §5).
 */
export function createSupabaseAdminClient(env: Env): AppSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
