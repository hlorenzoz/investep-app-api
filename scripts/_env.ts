/**
 * Helper de carga de variables de entorno para scripts CLI.
 *
 * Lee archivos `.dev.vars*` (formato dotenv KEY=VALUE, comillas opcionales).
 * Centraliza la lógica extraída de `send-test-email.ts` y agrega soporte
 * para seleccionar el entorno vía `--env <nombre>`.
 *
 * Scripts de uso (NO Worker runtime): los secretos de bootstrap (BOOTSTRAP_ADMIN_*)
 * se leen desde acá, nunca desde `src/types/env.ts` (AGENTS.md §5).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "../src/lib/supabase";
import type { Database } from "../src/types/database.types";

/**
 * Saca comillas simples o dobles que envuelvan el valor, como dotenv/wrangler.
 * Ej: `"valor"` → `valor`, `'valor'` → `valor`, `valor` → `valor`.
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.at(-1) === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parsea un archivo en formato dotenv (KEY=VALUE, comentarios con #, comillas opcionales).
 *
 * @param envName - Nombre del entorno a resolver. Mapea:
 *   - `"staging"`    → `.dev.vars.staging`
 *   - `"production"` → `.dev.vars.production`
 *   - `undefined`    → `.dev.vars`
 * @returns Mapa de claves y valores. Devuelve `{}` si el archivo no existe.
 */
export function loadDevVars(envName?: string): Record<string, string> {
  const path = envName ? `.dev.vars.${envName}` : ".dev.vars";

  if (!existsSync(path)) return {};

  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    vars[line.slice(0, eq).trim()] = unquote(line.slice(eq + 1).trim());
  }
  return vars;
}

/**
 * Construye un cliente Supabase admin (service-role) a partir de las vars de un
 * archivo de entorno. Centraliza la validación + config compartida por los scripts CLI
 * (provision-user, migrate-must-reset-flag).
 *
 * LANZA `Error` si faltan los secretos (en vez de `process.exit`): así es testeable y no
 * acopla el helper a un único modo de salida. El caller (cada script) decide cómo abortar.
 *
 * Scripts de uso (NO Worker runtime): `persistSession`/`autoRefreshToken` en false porque
 * son procesos de una sola pasada que no mantienen sesión.
 */
export function makeAdminFromVars(vars: Record<string, string>): AppSupabaseClient {
  const supabaseUrl = vars.SUPABASE_URL ?? "";
  const serviceRoleKey = vars.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el archivo de entorno.");
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
