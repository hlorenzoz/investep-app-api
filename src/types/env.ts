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

  // Orígenes permitidos por CORS (coma-separado, p. ej. "https://app.investep.com").
  // En dev/staging además se permite cualquier localhost. Vacío en prod = sin CORS.
  CORS_ORIGINS?: string;

  // Resend (envío de correo transaccional). API key del panel + remitente del dominio
  // verificado (formato "Nombre <correo@dominio>"). Opcionales como DOCS_TOKEN: no todos
  // los entornos los tienen cargados todavía y el cliente falla limpio si faltan.
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;

  // Bindings de Cloudflare
  CACHE: KVNamespace;
  DOCUMENTS: R2Bucket;
}
