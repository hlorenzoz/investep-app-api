/**
 * Bridge para correr k6 con el entorno del proyecto SIN exponer secretos.
 *
 * Lee `.dev.vars` (vía scripts/_env.ts) y pasa lo que k6 necesita por el ENVIRONMENT del
 * proceso hijo (k6 lo lee con `__ENV`), NUNCA por `-e` en la línea de comando: así los
 * secretos no quedan en el history del shell ni en `ps`. Tampoco se loguean valores
 * (AGENTS.md §5): solo se reporta qué credencial está presente.
 *
 * Precedencia: variables ya presentes en `process.env` ganan sobre `.dev.vars` (permite
 * override puntual de E2E_USER_EMAIL/E2E_USER_PASSWORD o apuntar a otro BASE_URL).
 *
 * Uso: bun run scripts/k6-run.ts <script.js> [args extra para k6...]
 */
import { loadDevVars } from "./_env";

const [scriptPath, ...rest] = process.argv.slice(2);

if (!scriptPath) {
  console.error("Uso: bun run scripts/k6-run.ts <script.js> [args k6...]");
  process.exit(1);
}

const vars = loadDevVars();

// Solo las vars que los scripts de carga necesitan (mínimo privilegio: NO la service-role).
const childEnv: Record<string, string | undefined> = {
  ...process.env,
  BASE_URL: process.env.BASE_URL ?? "http://localhost:8787",
  SUPABASE_URL: process.env.SUPABASE_URL ?? vars.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? vars.SUPABASE_ANON_KEY,
  E2E_USER_EMAIL: process.env.E2E_USER_EMAIL ?? vars.BOOTSTRAP_ADMIN_EMAIL,
  E2E_USER_PASSWORD: process.env.E2E_USER_PASSWORD ?? vars.BOOTSTRAP_ADMIN_PASSWORD,
};

// Diagnóstico SIN valores: solo presencia (sí/no) de cada credencial.
const present = (key: string) => (childEnv[key] ? "sí" : "no");
console.error(
  `[k6-run] ${scriptPath} → BASE_URL=${childEnv.BASE_URL} | creds: ` +
    `url=${present("SUPABASE_URL")} anon=${present("SUPABASE_ANON_KEY")} ` +
    `email=${present("E2E_USER_EMAIL")} pass=${present("E2E_USER_PASSWORD")}`,
);

let proc: ReturnType<typeof Bun.spawn>;
try {
  proc = Bun.spawn(["k6", "run", scriptPath, ...rest], {
    env: childEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
} catch {
  console.error("[k6-run] No se encontró k6 en PATH. Instalá con: brew install k6");
  process.exit(127);
}

process.exit(await proc.exited);
