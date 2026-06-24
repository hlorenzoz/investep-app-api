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
