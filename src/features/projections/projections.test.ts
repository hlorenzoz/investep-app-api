import { afterEach, describe, expect, it, mock } from "bun:test";
import { createApp } from "../../app";
import type { Env } from "../../types/env";

const ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

const AUTH = { headers: { Authorization: "Bearer t" } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EQUITY_PLAN = {
  account_type: "equity",
  target_monthly_pct: "25.00",
  target_daily_pct: "1.25",
};
const OPTIONS_PLAN = {
  account_type: "options",
  target_monthly_pct: "35.00",
  target_daily_pct: "35.00",
};

/** Enruta auth + la lectura de `investment_plans` (maybeSingle → array). Cuenta los hits al plan. */
function mockSupabase(plan: unknown | null, planStatus = 200) {
  const counter = { plans: 0 };
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return json({ id: "user-1", email: "u@example.com", user_metadata: {} });
    }
    if (url.includes("/investment_plans")) {
      counter.plans += 1;
      if (planStatus !== 200) {
        return json({ message: "boom", code: "", details: "", hint: "" }, planStatus);
      }
      return json(plan ? [plan] : []);
    }
    return json([]);
  }) as unknown as typeof fetch;
  return counter;
}

/** KV en memoria para ejercer el camino de cache HIT. */
function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

const url = (qs: string) => `/projections?${qs}`;
const BASE = "planId=1&baseAmount=15000&startDate=2026-07-01";

describe("GET /projections", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token", async () => {
    const res = await createApp().request(url(`${BASE}&grouping=monthly`), {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 equity mensual: 36 períodos, mes 1 = 15000 → +3750 → 18750", async () => {
    mockSupabase(EQUITY_PLAN);
    const res = await createApp().request(url(`${BASE}&grouping=monthly`), AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      planId: number;
      accountType: string;
      grouping: string;
      periods: { startBalance: number; yieldAmount: number; endBalance: number }[];
    };
    expect(body.accountType).toBe("equity");
    expect(body.grouping).toBe("monthly");
    expect(body.periods).toHaveLength(36);
    expect(body.periods[0]).toMatchObject({
      startBalance: 15000,
      yieldAmount: 3750,
      endBalance: 18750,
    });
  });

  it("200 options usa la tasa diaria del plan (3.5%/día sobre el total)", async () => {
    mockSupabase(OPTIONS_PLAN);
    const res = await createApp().request(
      url("planId=2&baseAmount=1000&startDate=2026-07-01&grouping=daily"),
      AUTH,
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accountType: string;
      periods: { startBalance: number; endBalance: number }[];
    };
    expect(body.accountType).toBe("options");
    expect(body.periods[0]).toMatchObject({ startBalance: 1000, endBalance: 1035 });
  });

  it("404 cuando el plan no existe", async () => {
    mockSupabase(null);
    const res = await createApp().request(url(`${BASE}&grouping=monthly`), AUTH, ENV);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("422 con grouping inválido", async () => {
    mockSupabase(EQUITY_PLAN);
    const res = await createApp().request(url(`${BASE}&grouping=quincenal`), AUTH, ENV);
    expect(res.status).toBe(422);
  });

  it("422 con startDate no parseable", async () => {
    mockSupabase(EQUITY_PLAN);
    const res = await createApp().request(
      url("planId=1&baseAmount=15000&startDate=no-date&grouping=monthly"),
      AUTH,
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("503 cuando Supabase está caído al resolver el plan", async () => {
    mockSupabase(EQUITY_PLAN, 500);
    const res = await createApp().request(url(`${BASE}&grouping=monthly`), AUTH, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("cachea la serie: 2do request idéntico es HIT (el plan se revalida por frescura)", async () => {
    const counter = mockSupabase(EQUITY_PLAN);
    const env = { ...ENV, CACHE: memoryKv() };
    const app = createApp();

    const first = await app.request(url(`${BASE}&grouping=monthly`), AUTH, env);
    expect(first.headers.get("X-Cache")).toBe("MISS");

    const second = await app.request(url(`${BASE}&grouping=monthly`), AUTH, env);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    // El plan se resuelve en CADA request (su tasa entra en la clave → no se sirve serie vieja
    // tras una edición del plan); el cache ahorra el cómputo de la serie, no la lectura del plan.
    expect(counter.plans).toBe(2);

    const body = (await second.json()) as { periods: unknown[] };
    expect(body.periods).toHaveLength(36);
  });
});
