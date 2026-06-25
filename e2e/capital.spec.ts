import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadDevVars } from "../scripts/_env";

/**
 * E2E de capital + asignaciones contra la API levantada de verdad + Supabase local.
 *
 * Requiere (NO se puede correr sin esto):
 *   - `just supabase-start` (Supabase local en Docker)
 *   - un usuario sembrado: BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD en `.dev.vars`
 *     (o E2E_USER_EMAIL / E2E_USER_PASSWORD en el entorno), creado con `just create-first-user`.
 *   - la API accesible (la levanta el `webServer` de playwright.config.ts).
 *
 * El token se obtiene con signInWithPassword (anon key), igual que `scripts/get-token.ts`.
 * El broker se lee por service-role: NO hay endpoint `GET /brokers` (es un stub).
 * Los tests que mutan estado limpian lo que crean (DB de test; `just supabase-reset` resetea todo).
 */

const vars = loadDevVars();
const SUPABASE_URL = vars.SUPABASE_URL ?? "";
const ANON_KEY = vars.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = vars.SUPABASE_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.E2E_USER_EMAIL ?? vars.BOOTSTRAP_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? vars.BOOTSTRAP_ADMIN_PASSWORD ?? "";

const canRun = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && EMAIL && PASSWORD);

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

/** Primer broker del catálogo (sin endpoint público → lectura directa con service-role). */
async function firstBrokerId(): Promise<number> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.from("brokers").select("id").order("id").limit(1).single();
  if (error || !data) throw new Error(`No se pudo leer un broker: ${error?.message ?? "vacío"}`);
  return data.id as number;
}

interface Allocation {
  id: string;
  brokerId: number;
  accountType: string;
}
interface CapitalView {
  capital: { totalCapital: number; currency: string } | null;
  allocations: Allocation[];
  totalAllocated: number;
  available: number;
}

test.describe("capital (E2E)", () => {
  test.skip(!canRun, "Faltan SUPABASE_URL/keys o credenciales de usuario (.dev.vars). Ver header.");

  let token = "";
  let authHeaders: Record<string, string> = {};
  test.beforeAll(async () => {
    token = await getAccessToken();
    authHeaders = { Authorization: `Bearer ${token}` };
  });

  test("GET /capital sin token → 401", async ({ request }) => {
    const res = await request.get("/capital");
    expect(res.status()).toBe(401);
  });

  test("GET /capital con token → 200 y shape esperado", async ({ request }) => {
    const res = await request.get("/capital", { headers: authHeaders });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as CapitalView;
    expect(Array.isArray(body.allocations)).toBe(true);
    expect(typeof body.totalAllocated).toBe("number");
    expect(typeof body.available).toBe("number");
  });

  test("GET /plans → 200 con al menos un plan del catálogo", async ({ request }) => {
    const res = await request.get("/plans?accountType=equity", { headers: authHeaders });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { plans: { id: number; accountType: string }[] };
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.plans[0]?.accountType).toBe("equity");
  });

  test("PUT /capital → 200 y GET lo refleja", async ({ request }) => {
    const put = await request.put("/capital", {
      headers: authHeaders,
      data: { totalCapital: 1_000_000, currency: "USD" },
    });
    expect(put.status()).toBe(200);

    const get = await request.get("/capital", { headers: authHeaders });
    const body = (await get.json()) as CapitalView;
    expect(body.capital?.totalCapital).toBe(1_000_000);
    expect(body.capital?.currency).toBe("USD");
  });

  test("ciclo de asignación: limpiar → POST 201 → GET refleja → DELETE 200", async ({
    request,
  }) => {
    // 1) Estado limpio: borrar TODAS las asignaciones del usuario para controlar el escenario.
    const current = (await (
      await request.get("/capital", { headers: authHeaders })
    ).json()) as CapitalView;
    for (const a of current.allocations) {
      await request.delete(`/capital/allocations/${a.id}`, { headers: authHeaders });
    }

    // 2) Capital alto (no debe quedar por debajo de lo asignado, ya limpiado).
    await request.put("/capital", {
      headers: authHeaders,
      data: { totalCapital: 1_000_000, currency: "USD" },
    });

    // 3) Plan equity real (vía API) + broker real (vía service-role).
    const plans = (await (
      await request.get("/plans?accountType=equity", { headers: authHeaders })
    ).json()) as { plans: { id: number }[] };
    const investmentPlanId = plans.plans[0]?.id;
    expect(investmentPlanId).toBeTruthy();
    const brokerId = await firstBrokerId();

    // 4) POST → 201
    const created = await request.post("/capital/allocations", {
      headers: authHeaders,
      data: { brokerId, investmentPlanId, initialDeposit: 4000 },
    });
    expect(created.status()).toBe(201);
    const { allocation } = (await created.json()) as { allocation: Allocation };
    expect(allocation.brokerId).toBe(brokerId);
    expect(allocation.accountType).toBe("equity");

    // 5) GET refleja la asignación
    const after = (await (
      await request.get("/capital", { headers: authHeaders })
    ).json()) as CapitalView;
    expect(after.allocations.some((a) => a.id === allocation.id)).toBe(true);
    expect(after.totalAllocated).toBe(4000);

    // 6) DELETE → 200 (limpieza)
    const deleted = await request.delete(`/capital/allocations/${allocation.id}`, {
      headers: authHeaders,
    });
    expect(deleted.status()).toBe(200);
  });

  test("PATCH con id malformado (no-UUID) → 422", async ({ request }) => {
    const res = await request.patch("/capital/allocations/not-a-uuid", {
      headers: authHeaders,
      data: { initialDeposit: 100 },
    });
    expect(res.status()).toBe(422);
  });
});
