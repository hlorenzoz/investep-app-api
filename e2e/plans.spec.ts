import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadDevVars } from "../scripts/_env";

/**
 * E2E del cálculo de `target_daily_pct` contra la API real + Supabase local.
 *
 * Esto es lo que NINGÚN unit test cubre: la fórmula vive en el trigger
 * `set_investment_plan_daily_pct` (migración 20260626000000), y `bun test` mockea
 * PostgREST a nivel `fetch`, así que nunca ejecuta el trigger. Acá pegamos contra
 * Postgres de verdad para verificar la MATEMÁTICA, no solo la coerción TS.
 *
 * Regla del trigger: equity → `round(target_monthly_pct / 20, 2)`; options → NULL.
 *
 * Requiere (NO se puede correr sin esto):
 *   - `just supabase-start` (Supabase local en Docker) con las migraciones aplicadas.
 *   - un usuario ADMIN sembrado (BOOTSTRAP_ADMIN_EMAIL/PASSWORD en `.dev.vars`, con
 *     `app_metadata.is_admin = true`); los endpoints `/admin/plans` exigen `requireAdmin`.
 *   - la API accesible (la levanta el `webServer` de playwright.config.ts).
 *
 * Usa valores de `targetMonthlyPct` que NO colisionan con el catálogo sembrado
 * (equity 25/50/100, options 35) y limpia cada plan que crea.
 */

const vars = loadDevVars();
const SUPABASE_URL = vars.SUPABASE_URL ?? "";
const ANON_KEY = vars.SUPABASE_ANON_KEY ?? "";
const EMAIL = process.env.E2E_USER_EMAIL ?? vars.BOOTSTRAP_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? vars.BOOTSTRAP_ADMIN_PASSWORD ?? "";

const canRun = Boolean(SUPABASE_URL && ANON_KEY && EMAIL && PASSWORD);

// Mensuales reservados para estos tests (fuera del catálogo sembrado: equity 25/50/100,
// options 35). Cada test usa valores DISTINTOS para no chocar con la constraint única
// (account_type, target_monthly_pct) — clave porque comparten el mismo account_type.
const EQUITY_MONTHLY = 40; // test 1: 40 / 20 = 2.00
const OPTIONS_MONTHLY = 45; // test 2: options → NULL (la fórmula de options no está definida)
const EQUITY_PATCH_FROM = 60; // test 3: 60 / 20 = 3.00
const EQUITY_PATCH_TO = 80; // test 3 (tras PATCH): 80 / 20 = 4.00
const ALL_TEST_MONTHLIES = [EQUITY_MONTHLY, OPTIONS_MONTHLY, EQUITY_PATCH_FROM, EQUITY_PATCH_TO];

async function getAccessToken(): Promise<string> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`No se pudo obtener el token e2e: ${error?.message ?? "sin sesión"}`);
  }
  return data.session.access_token;
}

interface PlanAdminView {
  id: number;
  accountType: string;
  targetMonthlyPct: number;
  targetDailyPct: number | null;
  translations: { locale: string; label: string }[];
}

// Serial: los tests comparten `account_type` y se sembran/limpian sobre la misma tabla;
// el modo paralelo por defecto provocaría carreras y choques de la constraint única.
test.describe.configure({ mode: "serial" });

test.describe("plans: cálculo de target_daily_pct (E2E)", () => {
  test.skip(!canRun, "Faltan SUPABASE_URL/keys o credenciales de admin (.dev.vars). Ver header.");

  let authHeaders: Record<string, string> = {};

  // Borra cualquier plan residual con los mensuales de test (ej. de una corrida que falló antes).
  async function cleanupTestPlans(request: import("@playwright/test").APIRequestContext) {
    for (const accountType of ["equity", "options"] as const) {
      const res = await request.get(`/plans?accountType=${accountType}`, { headers: authHeaders });
      if (res.status() !== 200) continue;
      const body = (await res.json()) as { plans: { id: number; targetMonthlyPct: number }[] };
      for (const plan of body.plans) {
        if (ALL_TEST_MONTHLIES.includes(plan.targetMonthlyPct)) {
          await request.delete(`/admin/plans/${plan.id}`, { headers: authHeaders });
        }
      }
    }
  }

  test.beforeAll(async ({ request }) => {
    const token = await getAccessToken();
    authHeaders = { Authorization: `Bearer ${token}` };
    await cleanupTestPlans(request); // arranca de un estado limpio (restos de corridas previas)
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestPlans(request);
  });

  test("equity: el trigger deriva el diario como mensual ÷ 20", async ({ request }) => {
    const res = await request.post("/admin/plans", {
      headers: authHeaders,
      data: {
        accountType: "equity",
        targetMonthlyPct: EQUITY_MONTHLY,
        translations: [{ locale: "es", label: "E2E equity 40%" }],
      },
    });
    expect(res.status()).toBe(201);
    const { plan } = (await res.json()) as { plan: PlanAdminView };

    // La matemática del trigger: 40 / 20 = 2.00 (NO se la pasamos nosotros).
    expect(plan.targetMonthlyPct).toBe(EQUITY_MONTHLY);
    expect(plan.targetDailyPct).toBe(2);
  });

  test("options: el diario queda en NULL (su fórmula no está definida)", async ({ request }) => {
    const res = await request.post("/admin/plans", {
      headers: authHeaders,
      data: {
        accountType: "options",
        targetMonthlyPct: OPTIONS_MONTHLY,
        translations: [{ locale: "es", label: "E2E options 45%" }],
      },
    });
    expect(res.status()).toBe(201);
    const { plan } = (await res.json()) as { plan: PlanAdminView };

    // Aunque 45 / 20 = 2.25, el trigger NO calcula para options: debe quedar null.
    expect(plan.targetDailyPct).toBeNull();
  });

  test("equity: PATCH del mensual recalcula el diario automáticamente", async ({ request }) => {
    const created = await request.post("/admin/plans", {
      headers: authHeaders,
      data: {
        accountType: "equity",
        targetMonthlyPct: EQUITY_PATCH_FROM,
        translations: [{ locale: "es", label: "E2E equity recálculo" }],
      },
    });
    expect(created.status()).toBe(201);
    const { plan } = (await created.json()) as { plan: PlanAdminView };
    expect(plan.targetDailyPct).toBe(3); // 60 / 20

    const patched = await request.patch(`/admin/plans/${plan.id}`, {
      headers: authHeaders,
      data: { targetMonthlyPct: EQUITY_PATCH_TO },
    });
    expect(patched.status()).toBe(200);
    const { plan: updated } = (await patched.json()) as { plan: PlanAdminView };

    // El trigger recalcula sin que toquemos el diario: 80 / 20 = 4.00.
    expect(updated.targetMonthlyPct).toBe(EQUITY_PATCH_TO);
    expect(updated.targetDailyPct).toBe(4);
  });
});
