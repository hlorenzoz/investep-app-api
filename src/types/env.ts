/**
 * Bindings y variables de entorno del Worker (AGENTS.md §2/§3).
 * Los secretos llegan como secrets de Wrangler / `.dev.vars` — nunca hardcodeados.
 * KVNamespace y R2Bucket son globales de `@cloudflare/workers-types`.
 */
export type Environment = "development" | "staging" | "production";

/**
 * Binding de Rate Limiting nativo de Workers (wrangler.jsonc → unsafe.bindings,
 * type "ratelimit"). Interfaz propia (no de @cloudflare/workers-types) para no
 * atar los tests ni el código a la versión de los tipos generados.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

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

  // Rate limiting nativo (unsafe.bindings en wrangler.jsonc). Opcionales: si faltan
  // (tests, entorno local sin soporte) el middleware hace fail-open y lo loguea.
  AUTH_RATE_LIMITER?: RateLimiter;
  ADMIN_WRITE_RATE_LIMITER?: RateLimiter;
}
