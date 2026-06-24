/**
 * CLI: obtiene un access_token JWT iniciando sesión con email y contraseña.
 *
 * Uso:
 *   bun run scripts/get-token.ts [EMAIL] [PASSWORD] [--env <nombre>]
 *   just token
 *   just token EMAIL PASSWORD
 *
 * Si EMAIL / PASSWORD se omiten, se toman de BOOTSTRAP_ADMIN_EMAIL /
 * BOOTSTRAP_ADMIN_PASSWORD del archivo de entorno.
 *
 * Imprime SOLO el access_token en stdout. NUNCA imprime la contraseña,
 * el objeto de sesión completo ni el JWT por console.error/console.warn.
 *
 * Usa la clave ANON (publishable) — la única correcta para signInWithPassword.
 * La service-role key NO sirve para este flujo (ADR-3 del diseño).
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import { loadDevVars } from "./_env";

// ---------------------------------------------------------------------------
// Parseo de argumentos
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}

const vars = loadDevVars(envName);

const emailArg = args[0] || "";
const passwordArg = args[1] || "";

const email = emailArg || vars.BOOTSTRAP_ADMIN_EMAIL || "";
const password = passwordArg || vars.BOOTSTRAP_ADMIN_PASSWORD || "";

if (!email || !password) {
  console.error(
    "Faltan EMAIL o PASSWORD: pasalos como argumentos o definí BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD en el archivo de entorno.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente Supabase estándar (anon/publishable key — requerido para signInWithPassword)
// ---------------------------------------------------------------------------

const supabaseUrl = vars.SUPABASE_URL ?? "";
const anonKey = vars.SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !anonKey) {
  console.error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el archivo de entorno.");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Inicio de sesión
// ---------------------------------------------------------------------------

try {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error(`Error al iniciar sesión: ${error.message}`);
    process.exit(1);
  }

  const token = data.session?.access_token;
  if (!token) {
    console.error("No se obtuvo un access_token en la respuesta.");
    process.exit(1);
  }

  // Imprime SOLO el token — sin trailing newline adicional para facilitar piping
  process.stdout.write(`${token}\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : "error desconocido";
  console.error(`Error inesperado: ${message}`);
  process.exit(1);
}
