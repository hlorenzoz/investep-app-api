/**
 * CLI one-shot: migra el flag `must_reset_password` de `user_metadata` → `app_metadata`.
 *
 * Contexto: `must_reset_password` es un control de seguridad. En `user_metadata` el propio
 * usuario podía apagarlo desde el browser (`auth.updateUser({ data })`). Ahora vive en
 * `app_metadata` (solo escribible con la service-role key). Los usuarios YA existentes
 * tienen el flag en `user_metadata`; este script lo copia a `app_metadata` y lo borra de
 * `user_metadata`.
 *
 * Uso:
 *   bun run scripts/migrate-must-reset-flag.ts [--env <nombre>]
 *   just migrate-must-reset
 *   just migrate-must-reset staging
 *
 * Idempotente: re-correrlo es seguro (gateado por presencia en `app_metadata`, vía
 * `decideMustResetMigration`). Operativa: correrlo ANTES de desplegar el código que lee
 * `app_metadata`. NUNCA imprime datos sensibles: solo contadores.
 *
 * LÍMITE conocido (padrones grandes): la paginación se apoya en `data.nextPage` de
 * supabase-js. Para >~450 usuarios (≈9 páginas) conviene verificar el parseo de páginas de
 * la versión de supabase-js antes de confiar en los contadores, o migrar por lotes. Para el
 * padrón actual (arranque, pocos usuarios) no aplica.
 */
import type { User } from "@supabase/supabase-js";
// Imports directos al módulo (no al barrel `../src/features/auth`, que arrastraría el router
// Hono a este script CLI). La decisión de migración vive testeada en su propio módulo.
import { MUST_RESET_PASSWORD_KEY } from "../src/features/auth/metadata";
import { decideMustResetMigration } from "../src/features/auth/must-reset-migration";
import { loadDevVars, makeAdminFromVars } from "./_env";

// ---------------------------------------------------------------------------
// Parseo de argumentos (--env <nombre>)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}
// Permitir también `migrate-must-reset staging` (posicional, sin --env), como otras recetas.
if (!envName && args[0]) {
  envName = args[0];
}

const vars = loadDevVars(envName);

// Cliente Supabase admin (service-role). Validación + config compartida en `_env.ts`.
let admin: ReturnType<typeof makeAdminFromVars>;
try {
  admin = makeAdminFromVars(vars);
} catch (err) {
  console.error(err instanceof Error ? err.message : "Error de configuración.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Migración
// ---------------------------------------------------------------------------

const perPage = 50;
let page = 1;
let scanned = 0;
let migrated = 0;
let skipped = 0;
let failed = 0;

try {
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`Error al listar usuarios (página ${page}): ${error.message}`);
      process.exit(1);
    }

    const users: User[] = data?.users ?? [];
    for (const user of users) {
      scanned++;

      // Gate de idempotencia + cálculo del flag: lógica pura testeada en `must-reset-migration`.
      const decision = decideMustResetMigration(user);
      if (decision.action === "skip") {
        skipped++;
        continue;
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
        // Copia el valor original a app_metadata (server-side only).
        app_metadata: { [MUST_RESET_PASSWORD_KEY]: decision.flagValue },
        // Borra la clave de user_metadata (null elimina la clave en GoTrue).
        user_metadata: { [MUST_RESET_PASSWORD_KEY]: null },
      });

      if (updateError) {
        failed++;
        console.error(`No se pudo migrar al usuario ${user.id}: ${updateError.message}`);
        continue;
      }
      migrated++;
    }

    // `nextPage` es la señal autoritativa (GoTrue lo deja null en la última página). El segundo
    // término solo corta ante una página vacía (guarda contra un loop infinito si nextPage viniera
    // malformado), sin cortar de más ante una última página parcial.
    const nextPage = (data as unknown as { nextPage?: number | null })?.nextPage;
    if (!nextPage || users.length === 0) break;
    page = nextPage;
  }

  console.log(JSON.stringify({ scanned, migrated, skipped, failed }));
  if (failed > 0) process.exit(1);
} catch (err) {
  const message = err instanceof Error ? err.message : "error desconocido";
  console.error(`Error inesperado durante la migración: ${message}`);
  process.exit(1);
}
