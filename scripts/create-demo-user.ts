/**
 * CLI: crea/actualiza UN usuario demo (demo@hlorenzoz.com / "demo") con data completa para
 * probar la interfaz: 2 cuentas de bróker (activos 25% mensual + opciones 35% diario, 90/10) y
 * un mes de operaciones en cada una (mezcla de cerradas con ganancia/pérdida y abiertas).
 *
 * Uso:
 *   bun run scripts/create-demo-user.ts [ENV]     // ENV: "" (local) | staging | production
 *   just create-demo-user
 *
 * Verificado (email_confirm) y SIN cambio de contraseña forzado, SIN enviar correo. Idempotente:
 * re-ejecutable (regenera las operaciones). Imprime un resumen JSON — NUNCA la contraseña.
 *
 * Nota: la contraseña "demo" (4 chars) la acepta el `createUser` admin del GoTrue local (no valida
 * el mínimo); `updateUserById` SÍ lo valida, por eso el reset no reenvía la contraseña. En Supabase
 * cloud el mínimo de contraseña podría rechazar "demo" incluso en la creación (staging/production).
 *
 * Prerrequisito: migraciones aplicadas (planes equity 25 y options 35, brokers sembrados).
 */
import { MUST_RESET_PASSWORD_KEY } from "../src/features/auth/metadata";
import type { AppSupabaseClient } from "../src/lib/supabase";
import { loadDevVars, makeAdminFromVars } from "./_env";

type AccountType = "equity" | "options";

const EMAIL = "demo@hlorenzoz.com";
const PASSWORD = "demo";
const FULL_NAME = "Demo";
const CURRENCY = "USD";
const EQUITY_MONTHLY_PCT = 25;
const OPTIONS_DAILY_PCT = 35;
const EQUITY_DEPOSIT = 9000; // 90/10 sobre 10.000
const OPTIONS_DEPOSIT = 1000;

// Brokers demo (set fijo y sembrado): activos y opciones en plataformas distintas.
const EQUITY_BROKER_SLUG = "interactive-brokers";
const OPTIONS_BROKER_SLUG = "tastytrade";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Definición de las operaciones a simular (fechas relativas a "hoy" al correr).
// ---------------------------------------------------------------------------

interface EquityOp {
  ticker: string;
  openDaysAgo: number;
  quantity: number;
  buyPrice: number;
  sellDaysAgo?: number;
  sellPrice?: number;
  strategy?: string;
}

interface OptionOp {
  ticker: string;
  openDaysAgo: number;
  quantity: number;
  buyPrice: number;
  strike: number;
  expiresInDays: number; // días después de la apertura
  contractType: "call" | "put";
  sellDaysAgo?: number;
  sellPrice?: number;
}

// Activos: swing/breakout con cierres en verde y uno en rojo, más 2 posiciones abiertas.
const EQUITY_OPS: EquityOp[] = [
  {
    ticker: "AAPL",
    openDaysAgo: 38,
    quantity: 10,
    buyPrice: 182.5,
    sellDaysAgo: 30,
    sellPrice: 196.2,
    strategy: "Swing",
  },
  {
    ticker: "MSFT",
    openDaysAgo: 34,
    quantity: 8,
    buyPrice: 402.0,
    sellDaysAgo: 26,
    sellPrice: 418.5,
  },
  {
    ticker: "NVDA",
    openDaysAgo: 30,
    quantity: 15,
    buyPrice: 108.4,
    sellDaysAgo: 21,
    sellPrice: 126.7,
    strategy: "Breakout",
  },
  {
    ticker: "TSLA",
    openDaysAgo: 24,
    quantity: 6,
    buyPrice: 242.0,
    sellDaysAgo: 16,
    sellPrice: 228.3,
  }, // pérdida
  {
    ticker: "GOOGL",
    openDaysAgo: 18,
    quantity: 12,
    buyPrice: 166.8,
    sellDaysAgo: 9,
    sellPrice: 174.1,
  },
  { ticker: "AMZN", openDaysAgo: 11, quantity: 7, buyPrice: 184.2 }, // abierta
  { ticker: "META", openDaysAgo: 4, quantity: 4, buyPrice: 512.5 }, // abierta
];

// Opciones: calls/puts con primas chicas y cantidades enteras (×100 por contrato).
const OPTION_OPS: OptionOp[] = [
  {
    ticker: "AAPL",
    openDaysAgo: 35,
    quantity: 2,
    buyPrice: 3.4,
    strike: 185,
    expiresInDays: 30,
    contractType: "call",
    sellDaysAgo: 28,
    sellPrice: 5.1,
  },
  {
    ticker: "NVDA",
    openDaysAgo: 30,
    quantity: 1,
    buyPrice: 4.2,
    strike: 105,
    expiresInDays: 28,
    contractType: "put",
    sellDaysAgo: 22,
    sellPrice: 2.05,
  }, // pérdida
  {
    ticker: "SPY",
    openDaysAgo: 24,
    quantity: 3,
    buyPrice: 2.15,
    strike: 552,
    expiresInDays: 35,
    contractType: "call",
    sellDaysAgo: 13,
    sellPrice: 3.35,
  },
  {
    ticker: "TSLA",
    openDaysAgo: 16,
    quantity: 1,
    buyPrice: 6.6,
    strike: 250,
    expiresInDays: 40,
    contractType: "call",
    sellDaysAgo: 6,
    sellPrice: 9.1,
  },
  {
    ticker: "MSFT",
    openDaysAgo: 8,
    quantity: 2,
    buyPrice: 5.05,
    strike: 420,
    expiresInDays: 30,
    contractType: "call",
  }, // abierta
  {
    ticker: "QQQ",
    openDaysAgo: 3,
    quantity: 1,
    buyPrice: 3.75,
    strike: 478,
    expiresInDays: 25,
    contractType: "put",
  }, // abierta
];

// ---------------------------------------------------------------------------
// Argumentos + cliente
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}
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

const now = Date.now();
const isoDaysAgo = (n: number): string => new Date(now - n * DAY_MS).toISOString();
const dateOnly = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

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

async function createOrResetUser(): Promise<{ userId: string; created: boolean }> {
  const appMetadata = { [MUST_RESET_PASSWORD_KEY]: false };
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (!error) {
    const id = data.user?.id;
    if (!id) fail("Respuesta inesperada al crear el usuario demo.");
    return { userId: id, created: true };
  }
  const code = (error as { code?: string }).code;
  const exists =
    code === "email_exists" ||
    code === "user_already_exists" ||
    error.message.includes("already registered");
  if (!exists) fail(`Error al crear ${EMAIL}: ${error.message}`);

  const existing = await findUserByEmail(EMAIL);
  if (!existing) fail(`${EMAIL} ya existe pero no se pudo localizar.`);
  // GoTrue admin `createUser` NO valida el mínimo de contraseña, pero `updateUserById` SÍ:
  // reenviar "demo" (4 chars) en el reset lo rechazaría. Se mantiene la contraseña original y
  // solo se reafirman verificación + flags (idempotente).
  const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (updErr) fail(`Error al resetear ${EMAIL}: ${updErr.message}`);
  return { userId: existing.id, created: false };
}

async function resolveBrokerId(slug: string): Promise<number> {
  const { data, error } = await admin.from("brokers").select("id").eq("slug", slug).maybeSingle();
  if (error) fail(`Error al leer el broker '${slug}': ${error.message}`);
  if (!data) fail(`Falta el broker '${slug}'. Corré las migraciones/seeds.`);
  return data.id;
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

/** Update-or-insert de una allocation (unique removida → no hay upsert) y devuelve su id. */
async function upsertAllocation(
  userId: string,
  brokerId: number,
  accountType: AccountType,
  investmentPlanId: number,
  deposit: number,
): Promise<string> {
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
    const id = existing[0].id;
    const { error } = await admin.from("broker_allocations").update(row).eq("id", id);
    if (error) fail(`Error al actualizar allocation: ${error.message}`);
    return id;
  }
  const { data, error } = await admin
    .from("broker_allocations")
    .insert({ user_id: userId, broker_id: brokerId, account_type: accountType, ...row })
    .select("id")
    .single();
  if (error || !data) fail(`Error al insertar allocation: ${error?.message}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

function equityRows(userId: string, allocationId: string) {
  return EQUITY_OPS.map((op) => ({
    user_id: userId,
    allocation_id: allocationId,
    account_type: "equity" as const,
    ticker: op.ticker,
    opened_at: isoDaysAgo(op.openDaysAgo),
    quantity: op.quantity,
    buy_price: op.buyPrice,
    sold_at: op.sellDaysAgo != null ? isoDaysAgo(op.sellDaysAgo) : null,
    sell_price: op.sellPrice ?? null,
    strategy: op.strategy ?? null,
  }));
}

function optionRows(userId: string, allocationId: string) {
  return OPTION_OPS.map((op) => {
    const openMs = now - op.openDaysAgo * DAY_MS;
    return {
      user_id: userId,
      allocation_id: allocationId,
      account_type: "options" as const,
      ticker: op.ticker,
      opened_at: new Date(openMs).toISOString(),
      quantity: op.quantity,
      buy_price: op.buyPrice,
      strike: op.strike,
      expiration_date: dateOnly(openMs + op.expiresInDays * DAY_MS),
      contract_type: op.contractType,
      sold_at: op.sellDaysAgo != null ? isoDaysAgo(op.sellDaysAgo) : null,
      sell_price: op.sellPrice ?? null,
    };
  });
}

/** Regenera las operaciones del usuario (borra + inserta) → idempotente. */
async function seedOperations(
  userId: string,
  equityAllocationId: string,
  optionsAllocationId: string,
): Promise<number> {
  const { error: delErr } = await admin.from("trade_operations").delete().eq("user_id", userId);
  if (delErr) fail(`Error al limpiar operaciones: ${delErr.message}`);

  const rows = [
    ...equityRows(userId, equityAllocationId),
    ...optionRows(userId, optionsAllocationId),
  ];
  const { error: insErr } = await admin.from("trade_operations").insert(rows);
  if (insErr) fail(`Error al insertar operaciones: ${insErr.message}`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const equityBrokerId = await resolveBrokerId(EQUITY_BROKER_SLUG);
  const optionsBrokerId = await resolveBrokerId(OPTIONS_BROKER_SLUG);
  const equityPlanId = await resolvePlanId("equity", EQUITY_MONTHLY_PCT);
  const optionsPlanId = await resolvePlanId("options", OPTIONS_DAILY_PCT);

  const { userId, created } = await createOrResetUser();

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: userId, full_name: FULL_NAME }, { onConflict: "id" });
  if (profileErr) fail(`Error al upsertar profile: ${profileErr.message}`);

  const { error: capErr } = await admin
    .from("user_capital")
    .upsert(
      { user_id: userId, total_capital: EQUITY_DEPOSIT + OPTIONS_DEPOSIT, currency: CURRENCY },
      { onConflict: "user_id" },
    );
  if (capErr) fail(`Error al upsertar capital: ${capErr.message}`);

  const equityAllocationId = await upsertAllocation(
    userId,
    equityBrokerId,
    "equity",
    equityPlanId,
    EQUITY_DEPOSIT,
  );
  const optionsAllocationId = await upsertAllocation(
    userId,
    optionsBrokerId,
    "options",
    optionsPlanId,
    OPTIONS_DEPOSIT,
  );

  const operations = await seedOperations(userId, equityAllocationId, optionsAllocationId);

  console.log(
    JSON.stringify({
      env: envName ?? "local",
      email: EMAIL,
      userId,
      created,
      accounts: [
        { accountType: "equity", broker: EQUITY_BROKER_SLUG, deposit: EQUITY_DEPOSIT },
        { accountType: "options", broker: OPTIONS_BROKER_SLUG, deposit: OPTIONS_DEPOSIT },
      ],
      operations,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Error inesperado.");
  process.exit(1);
});
