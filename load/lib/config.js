// Config de los scripts de carga, leída de __ENV (la inyecta scripts/k6-run.ts por
// environment del proceso). Valores host-reachables: la API publicada en 8787 y la
// Supabase local (GoTrue) en 127.0.0.1:54321 — NO la URL interna de Kong del contenedor.

export const BASE_URL = __ENV.BASE_URL || "http://localhost:8787";
export const SUPABASE_URL = __ENV.SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "";
export const EMAIL = __ENV.E2E_USER_EMAIL || "";
export const PASSWORD = __ENV.E2E_USER_PASSWORD || "";

// ¿Hay credenciales para los escenarios autenticados?
export const hasCreds = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && EMAIL && PASSWORD);
