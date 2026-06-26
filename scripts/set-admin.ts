/**
 * CLI: marca (o revoca) a un usuario como administrador.
 *
 * El rol admin vive en `app_metadata.is_admin` (control de seguridad server-side, SOLO
 * escribible con la service-role key — el usuario no puede auto-otorgárselo desde el browser).
 * Lo consume `requireAdmin` para proteger el CRUD de catálogos (brokers, plans). A propósito
 * NO hay endpoint que otorgue admin (evita escalada de privilegios): se hace por este script.
 *
 * Uso:
 *   bun run scripts/set-admin.ts [EMAIL] [--revoke] [--env <nombre>]
 *   just set-admin alguien@dominio.com          # otorga admin
 *   just set-admin alguien@dominio.com --revoke # revoca admin
 *   just set-admin                              # usa BOOTSTRAP_ADMIN_EMAIL del .dev.vars
 *   just set-admin alguien@dominio.com --env staging
 *
 * Idempotente: re-correrlo es seguro. Imprime SOLO { userId, email, isAdmin } — nunca el JWT
 * ni datos sensibles.
 */
import type { User } from "@supabase/supabase-js";
import { IS_ADMIN_KEY } from "../src/features/auth/metadata";
import { loadDevVars, makeAdminFromVars } from "./_env";

// ---------------------------------------------------------------------------
// Parseo de argumentos: [EMAIL] [--revoke] [--env <nombre>]
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}

// `--revoke` apaga el flag en vez de prenderlo.
let revoke = false;
const revokeIdx = args.indexOf("--revoke");
if (revokeIdx !== -1) {
  revoke = true;
  args.splice(revokeIdx, 1);
}

const vars = loadDevVars(envName);

// EMAIL posicional; si se omite, cae al bootstrap admin del archivo de entorno.
const email = (args[0] || vars.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
if (!email) {
  console.error(
    "Falta EMAIL: pasalo como argumento posicional o definí BOOTSTRAP_ADMIN_EMAIL en el archivo de entorno.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente Supabase (admin). Validación + config compartida en `_env.ts`.
// ---------------------------------------------------------------------------

let admin: ReturnType<typeof makeAdminFromVars>;
try {
  admin = makeAdminFromVars(vars);
} catch (err) {
  console.error(err instanceof Error ? err.message : "Error de configuración.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolución del usuario por email (GoTrue no expone get-by-email: se pagina y filtra).
// ---------------------------------------------------------------------------

async function findUserByEmail(targetEmail: string): Promise<User | null> {
  const perPage = 50;
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`Error al listar usuarios (página ${page}): ${error.message}`);
      process.exit(1);
    }
    const users: User[] = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === targetEmail);
    if (match) return match;

    const nextPage = (data as unknown as { nextPage?: number | null })?.nextPage;
    if (!nextPage || users.length === 0) return null;
    page = nextPage;
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

try {
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No existe un usuario con el email ${email}.`);
    process.exit(1);
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    // `is_admin` en app_metadata (server-side only). `false` lo deja explícito (revoca).
    app_metadata: { [IS_ADMIN_KEY]: !revoke },
  });
  if (error) {
    console.error(`No se pudo actualizar al usuario ${user.id}: ${error.message}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ userId: user.id, email, isAdmin: !revoke }));
} catch (err) {
  const message = err instanceof Error ? err.message : "error desconocido";
  console.error(`Error inesperado: ${message}`);
  process.exit(1);
}
