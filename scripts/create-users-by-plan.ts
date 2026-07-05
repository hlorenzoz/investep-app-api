/**
 * CLI: crea/actualiza las 4 cuentas demo por plan (bronze/silver/gold/platinum).
 *
 * Uso:
 *   bun run scripts/create-users-by-plan.ts [ENV]        // ENV: "" (local) | staging | production
 *   just create-users-by-plan
 *   just create-users-by-plan staging
 *
 * Cuentas verificadas (email_confirm) y SIN cambio de contraseña forzado
 * (must_reset_password=false), SIN enviar correo. Idempotente: re-ejecutable en los 3
 * entornos. Imprime un resumen JSON — NUNCA contraseñas.
 *
 * Prerrequisito: migraciones aplicadas (planes equity 25 y options 35 sembrados).
 */

import { MUST_RESET_PASSWORD_KEY } from "../src/features/auth/metadata";
import type { AppSupabaseClient } from "../src/lib/supabase";
import { loadDevVars, makeAdminFromVars } from "./_env";

type AccountType = "equity" | "options";

interface AccountSpec {
  type: AccountType;
  deposit: number;
}

interface TierSpec {
  slug: string;
  accounts: AccountSpec[];
}

// Composición por tier (bronze es caso especial: 1 sola cuenta de opciones).
const TIERS: TierSpec[] = [
  { slug: "bronze", accounts: [{ type: "options", deposit: 1000 }] },
  {
    slug: "silver",
    accounts: [
      { type: "equity", deposit: 9000 },
      { type: "options", deposit: 1000 },
    ],
  },
  {
    slug: "gold",
    accounts: [
      { type: "equity", deposit: 9000 },
      { type: "options", deposit: 1000 },
    ],
  },
  {
    slug: "platinum",
    accounts: [
      { type: "equity", deposit: 9000 },
      { type: "options", deposit: 1000 },
    ],
  },
];

// Tasas de los planes usados (deben existir en el catálogo, sembradas por migraciones).
const EQUITY_MONTHLY_PCT = 25;
const OPTIONS_DAILY_PCT = 35;
const CURRENCY = "USD";
const EMAIL_DOMAIN = "hlorenzoz.com";

// Brokers demo (deben estar sembrados). Set FIJO: la asignación por cuenta se hashea contra
// esta lista, no contra el catálogo, para que sumar brokers no rompa la idempotencia.
const DEMO_BROKER_SLUGS = ["interactive-brokers", "tastytrade", "etrade"];

// ---------------------------------------------------------------------------
// Parseo de argumentos (ENV opcional: posicional o --env <nombre>)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}
// También acepta el env como primer posicional (así lo pasa el justfile).
if (!envName && args[0]) envName = args[0];
if (envName === "") envName = undefined;

const vars = loadDevVars(envName);

let admin: AppSupabaseClient;
try {
  admin = makeAdminFromVars(vars);
} catch (err) {
  console.error(err instanceof Error ? err.message : "Error de configuración.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Paginación de la Admin API para encontrar un usuario por email (GoTrue no filtra por email). */
async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const perPage = 50;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Error al listar usuarios: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return { id: found.id };
    const nextPage = (data as unknown as { nextPage?: number | null })?.nextPage;
    if (!nextPage || users.length < perPage) return null;
  }
}

/**
 * Crea el usuario verificado y sin reset forzado; si ya existe, resetea su contraseña y
 * reafirma los flags. Idempotente.
 */
async function createOrResetUser(
  email: string,
  password: string,
): Promise<{ userId: string; created: boolean }> {
  const appMetadata = { [MUST_RESET_PASSWORD_KEY]: false };
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });

  if (!error) {
    const id = data.user?.id;
    if (!id) fail(`Respuesta inesperada al crear ${email}.`);
    return { userId: id, created: true };
  }

  const code = (error as { code?: string }).code;
  const alreadyExists =
    code === "email_exists" ||
    code === "user_already_exists" ||
    error.message.includes("already registered");
  if (!alreadyExists) fail(`Error al crear ${email}: ${error.message}`);

  const existing = await findUserByEmail(email);
  if (!existing) fail(`${email} ya existe pero no se pudo localizar en la paginación.`);
  const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (updateError) fail(`Error al resetear ${email}: ${updateError.message}`);
  return { userId: existing.id, created: false };
}

/**
 * Elige un slug de bróker determinístico por (email, tipo) sobre un set FIJO y conocido.
 * Clave: se hashea contra `DEMO_BROKER_SLUGS` (constante), NO contra la lista del catálogo —
 * así agregar/quitar brokers en la DB no corre las asignaciones y la re-ejecución sigue siendo
 * idempotente (la allocation apunta siempre al mismo bróker).
 */
function pickBrokerSlug(email: string, accountType: AccountType): string {
  const key = `${email}:${accountType}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i)) % 1_000_000;
  return DEMO_BROKER_SLUGS[hash % DEMO_BROKER_SLUGS.length];
}

/** Update-or-insert de una allocation (la unique (user,broker,type) fue removida → no hay upsert). */
async function upsertAllocation(
  userId: string,
  brokerId: number,
  accountType: AccountType,
  investmentPlanId: number,
  deposit: number,
): Promise<void> {
  const { data: existing, error: selErr } = await admin
    .from("broker_allocations")
    .select("id")
    .eq("user_id", userId)
    .eq("broker_id", brokerId)
    .eq("account_type", accountType)
    .limit(1);
  if (selErr) fail(`Error al leer allocations: ${selErr.message}`);

  const row = {
    investment_plan_id: investmentPlanId,
    initial_deposit: deposit,
    currency: CURRENCY,
  };
  if (existing && existing.length > 0) {
    const { error } = await admin.from("broker_allocations").update(row).eq("id", existing[0].id);
    if (error) fail(`Error al actualizar allocation: ${error.message}`);
  } else {
    const { error } = await admin.from("broker_allocations").insert({
      user_id: userId,
      broker_id: brokerId,
      account_type: accountType,
      ...row,
    });
    if (error) fail(`Error al insertar allocation: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Resolución del catálogo (fallar claro si falta → correr migraciones)
// ---------------------------------------------------------------------------

async function resolveBrokerMap(): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from("brokers")
    .select("id, slug")
    .in("slug", DEMO_BROKER_SLUGS);
  if (error) fail(`Error al leer brokers: ${error.message}`);
  const map = new Map<string, number>();
  for (const b of data ?? []) map.set(b.slug, b.id);
  for (const slug of DEMO_BROKER_SLUGS) {
    if (!map.has(slug)) fail(`Falta el broker '${slug}'. Corré las migraciones/seeds.`);
  }
  return map;
}

async function resolvePlanId(accountType: AccountType, pct: number): Promise<number> {
  const { data, error } = await admin
    .from("investment_plans")
    .select("id")
    .eq("account_type", accountType)
    .eq("target_monthly_pct", pct)
    .maybeSingle();
  if (error) fail(`Error al leer el plan ${accountType} ${pct}: ${error.message}`);
  if (!data) fail(`Falta el plan ${accountType} ${pct}%. Corré las migraciones/seeds.`);
  return data.id;
}

async function resolveInvestepPlanIds(): Promise<Map<string, number>> {
  const { data, error } = await admin.from("investep_plans").select("id, slug");
  if (error) fail(`Error al leer investep_plans: ${error.message}`);
  const map = new Map<string, number>();
  for (const p of data ?? []) map.set(p.slug, p.id);
  for (const t of TIERS) {
    if (!map.has(t.slug)) fail(`Falta el investep_plan '${t.slug}'. Corré las migraciones/seeds.`);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const brokerMap = await resolveBrokerMap();
  const planIds: Record<AccountType, number> = {
    equity: await resolvePlanId("equity", EQUITY_MONTHLY_PCT),
    options: await resolvePlanId("options", OPTIONS_DAILY_PCT),
  };
  const investepIds = await resolveInvestepPlanIds();

  const summary: Array<{ slug: string; email: string; userId: string; created: boolean }> = [];

  for (const tier of TIERS) {
    const email = `${tier.slug}@${EMAIL_DOMAIN}`;
    const password = `demo-${tier.slug}`;
    const fullName = `${tier.slug.charAt(0).toUpperCase()}${tier.slug.slice(1)} Demo`;

    const { userId, created } = await createOrResetUser(email, password);

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert({ id: userId, full_name: fullName }, { onConflict: "id" });
    if (profileErr) fail(`Error al upsertar profile de ${email}: ${profileErr.message}`);

    const total = tier.accounts.reduce((s, a) => s + a.deposit, 0);
    const { error: capErr } = await admin
      .from("user_capital")
      .upsert(
        { user_id: userId, total_capital: total, currency: CURRENCY },
        { onConflict: "user_id" },
      );
    if (capErr) fail(`Error al upsertar capital de ${email}: ${capErr.message}`);

    for (const account of tier.accounts) {
      const brokerId = brokerMap.get(pickBrokerSlug(email, account.type)) as number;
      await upsertAllocation(
        userId,
        brokerId,
        account.type,
        planIds[account.type],
        account.deposit,
      );
    }

    const { error: memErr } = await admin.from("academy_memberships").upsert(
      {
        user_id: userId,
        investep_plan_id: investepIds.get(tier.slug),
        status: "active",
        source: "admin",
      },
      { onConflict: "user_id" },
    );
    if (memErr) fail(`Error al upsertar membership de ${email}: ${memErr.message}`);

    summary.push({ slug: tier.slug, email, userId, created });
  }

  console.log(JSON.stringify({ env: envName ?? "local", users: summary }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Error inesperado.");
  process.exit(1);
});
