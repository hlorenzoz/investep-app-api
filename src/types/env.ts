/**
 * Bindings y variables de entorno del Worker (AGENTS.md §2/§3).
 * Los secretos llegan como secrets de Wrangler / `.dev.vars` — nunca hardcodeados.
 * KVNamespace y R2Bucket son globales de `@cloudflare/workers-types`.
 */
export type Environment = "development" | "staging" | "production";

export interface Env {
  // Variables públicas (wrangler.jsonc → vars)
  ENVIRONMENT: Environment;

  // Secretos (wrangler secret / .dev.vars) — NUNCA en código ni commiteados
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DOCS_TOKEN?: string;

  // Bindings de Cloudflare
  CACHE: KVNamespace;
  DOCUMENTS: R2Bucket;
}
