/**
 * CLI: aprovisiona un usuario en Supabase Auth y envía las credenciales por correo.
 *
 * Uso:
 *   bun run scripts/provision-user.ts [EMAIL] [PASSWORD] [--env <nombre>]
 *   just create-first-user
 *   just create-user EMAIL
 *   just create-user EMAIL PASSWORD
 *
 * Si EMAIL se omite, se toma BOOTSTRAP_ADMIN_EMAIL del archivo de entorno.
 * Si PASSWORD se omite (o es cadena vacía), se genera automáticamente.
 * Imprime SOLO { userId, created, emailId } — NUNCA la contraseña ni el JWT.
 */
import { provisionUser } from "../src/features/auth";
import { AppError } from "../src/lib/errors";
import { sendEmail } from "../src/lib/resend";
import { loadDevVars, makeAdminFromVars } from "./_env";

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

// Positional: [EMAIL] [PASSWORD] (ambos opcionales)
const emailArg = args[0] || "";
const passwordArg = args[1] || "";

const email = emailArg || vars.BOOTSTRAP_ADMIN_EMAIL || "";
// BOOTSTRAP_ADMIN_PASSWORD solo aplica en modo bootstrap (sin EMAIL posicional).
// Si se pasa EMAIL explícito y no PASSWORD, se deja undefined para que
// provisionUser genere una contraseña fuerte automáticamente.
const password = passwordArg || (emailArg ? undefined : vars.BOOTSTRAP_ADMIN_PASSWORD) || undefined;

if (!email) {
  console.error(
    "Falta EMAIL: pasalo como argumento posicional o definí BOOTSTRAP_ADMIN_EMAIL en el archivo de entorno.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente Supabase (admin)
// ---------------------------------------------------------------------------

// Validación + config compartida en `_env.ts` (mismo client que migrate-must-reset-flag).
let admin: ReturnType<typeof makeAdminFromVars>;
try {
  admin = makeAdminFromVars(vars);
} catch (err) {
  console.error(err instanceof Error ? err.message : "Error de configuración.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Bound sendEmail
// ---------------------------------------------------------------------------

const resendConfig = {
  RESEND_API_KEY: vars.RESEND_API_KEY,
  RESEND_FROM: vars.RESEND_FROM,
};

const boundSendEmail = (params: Parameters<typeof sendEmail>[1]) => sendEmail(resendConfig, params);

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

try {
  const result = await provisionUser({ admin, sendEmail: boundSendEmail }, { email, password });

  // SOLO imprime userId, created, emailId — NUNCA la contraseña
  console.log(
    JSON.stringify({ userId: result.userId, created: result.created, emailId: result.emailId }),
  );
} catch (err) {
  if (err instanceof AppError) {
    console.error(`Error [${err.code}]: ${err.message}`);
  } else {
    const message = err instanceof Error ? err.message : "error desconocido";
    console.error(`Error inesperado: ${message}`);
  }
  process.exit(1);
}
