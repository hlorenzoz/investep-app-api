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

/**
 * Mock de fetch que enruta: el endpoint de auth (validación del JWT) devuelve un
 * usuario válido; cualquier otra llamada (PostgREST) devuelve `restBody`.
 */
function mockFetch(restBody: unknown, restStatus = 200) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({ id: "uid-1", email: "u@example.com", user_metadata: {} }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify(restBody), {
      status: restStatus,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const PLANS_ROW = [
  {
    id: 1,
    account_type: "equity",
    target_monthly_pct: "25.00",
    investment_plan_translations: [
      { label: "Activos 25% mensual", locale: "es" },
      { label: "Equity 25% monthly", locale: "en" },
    ],
  },
];

describe("GET /plans", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token", async () => {
    const res = await createApp().request("/plans", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 lista planes con el label del locale pedido y coerce del numeric", async () => {
    mockFetch(PLANS_ROW);

    const res = await createApp().request(
      "/plans?locale=es",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      locale: string;
      plans: { id: number; accountType: string; targetMonthlyPct: number; label: string | null }[];
    };
    expect(body.locale).toBe("es");
    expect(body.plans[0]).toEqual({
      id: 1,
      accountType: "equity",
      targetMonthlyPct: 25,
      label: "Activos 25% mensual",
    });
  });

  it("usa locale 'es' por defecto cuando no se pasa", async () => {
    mockFetch(PLANS_ROW);

    const res = await createApp().request(
      "/plans",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { locale: string };
    expect(body.locale).toBe("es");
  });

  it("acepta el filtro accountType y devuelve 200", async () => {
    mockFetch(PLANS_ROW);

    const res = await createApp().request(
      "/plans?accountType=equity",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    expect(res.status).toBe(200);
  });

  it("label null cuando no hay traducción para el locale", async () => {
    mockFetch([
      {
        id: 9,
        account_type: "options",
        target_monthly_pct: "50.00",
        investment_plan_translations: [{ label: "Options 50% monthly", locale: "en" }],
      },
    ]);

    const res = await createApp().request(
      "/plans?locale=es",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    const body = (await res.json()) as { plans: { label: string | null }[] };
    expect(body.plans[0]?.label).toBeNull();
  });

  it("503 cuando Supabase está caído (5xx transitorio)", async () => {
    // outage/red caída → reintentable. Consistente con /capital y el middleware de auth.
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500);

    const res = await createApp().request(
      "/plans",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("500 ante un error genuino de PostgREST (4xx no transitorio)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 400);

    const res = await createApp().request(
      "/plans",
      { headers: { Authorization: "Bearer t" } },
      ENV,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
