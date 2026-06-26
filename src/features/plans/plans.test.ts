import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
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

/**
 * Mock que enruta auth (admin o no, vía `app_metadata.is_admin`) y PostgREST (`restBody`).
 */
function mockFetchAdmin(restBody: unknown, restStatus = 200, opts: { isAdmin?: boolean } = {}) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          id: "uid-1",
          email: "u@example.com",
          user_metadata: {},
          app_metadata: opts.isAdmin ? { is_admin: true } : {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(restBody), {
      status: restStatus,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const AUTH = { Authorization: "Bearer t" };
const PLAN_ROW = {
  id: 1,
  account_type: "equity",
  target_monthly_pct: "25.00",
  target_daily_pct: "1.25",
};
const PLAN_DETAIL = {
  ...PLAN_ROW,
  investment_plan_translations: [{ label: "Activos 25% mensual", locale: "es" }],
};
const CREATE_PAYLOAD = {
  accountType: "equity",
  targetMonthlyPct: 25,
  translations: [{ locale: "es", label: "Activos 25% mensual" }],
};

describe("Plans (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const createReq = {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(CREATE_PAYLOAD),
  };

  it("403 cuando el usuario no es admin", async () => {
    mockFetchAdmin(PLAN_ROW, 201, { isAdmin: false });
    const res = await createApp().request("/admin/plans", createReq, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("201 crea un plan siendo admin", async () => {
    mockFetchAdmin(PLAN_ROW, 201, { isAdmin: true });
    const res = await createApp().request("/admin/plans", createReq, ENV);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      plan: {
        id: number;
        accountType: string;
        targetDailyPct: number | null;
        translations: unknown[];
      };
    };
    expect(body.plan.id).toBe(1);
    expect(body.plan.accountType).toBe("equity");
    expect(body.plan.targetDailyPct).toBe(1.25);
    expect(body.plan.translations).toHaveLength(1);
  });

  it("409 cuando el par (tipo, target) ya existe", async () => {
    mockFetchAdmin({ code: "23505", message: "duplicate", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request("/admin/plans", createReq, ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 ante un cuerpo inválido (sin traducciones)", async () => {
    mockFetchAdmin(PLAN_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ accountType: "equity", targetMonthlyPct: 25, translations: [] }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("200 actualiza un plan siendo admin", async () => {
    mockFetchAdmin([PLAN_DETAIL], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ targetMonthlyPct: 25 }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { id: number } };
    expect(body.plan.id).toBe(1);
  });

  it("404 al actualizar un plan inexistente", async () => {
    mockFetchAdmin([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ targetMonthlyPct: 30 }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("200 elimina un plan siendo admin", async () => {
    mockFetchAdmin([{ id: 1 }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("404 al eliminar un plan inexistente", async () => {
    mockFetchAdmin([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  // FK violation (23503) sobre investment_plan_translations = locale inexistente en `locales`.
  const FK_ERROR = { code: "23503", message: "fk violation", details: "", hint: "" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const adminAuth = () =>
    json({
      id: "uid-1",
      email: "u@example.com",
      user_metadata: {},
      app_metadata: { is_admin: true },
    });

  // Enruta por PATH (no por la URL completa): el `select=` de los planes EMBEBE
  // `investment_plan_translations`, así que un match por substring confundiría esa lectura
  // con la tabla de traducciones. El path sí distingue la tabla destino real.
  const isTranslationsTable = (url: string) =>
    new URL(url).pathname.endsWith("/investment_plan_translations");

  it("422 cuando una traducción usa un locale desconocido (create)", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return adminAuth();
      // El insert de traducciones falla por FK (locale inválido); el resto (insert/rollback del plan) OK.
      if (isTranslationsTable(url)) return json(FK_ERROR, 409);
      return json(PLAN_ROW, 201);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/plans",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          accountType: "equity",
          targetMonthlyPct: 25,
          translations: [{ locale: "xx", label: "x" }],
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 cuando una traducción usa un locale desconocido (update)", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return adminAuth();
      if (isTranslationsTable(url)) return json(FK_ERROR, 409);
      return json([PLAN_DETAIL]); // getPlanDetail: el plan existe.
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/plans/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ translations: [{ locale: "xx", label: "x" }] }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // --- Ramas de error / resiliencia / integridad ---

  it("503 cuando Supabase está caído al insertar el plan (5xx transitorio)", async () => {
    mockFetchAdmin({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request("/admin/plans", createReq, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 y emite un evento estructurado si las traducciones fallan (no-FK) y el rollback del plan también falla", async () => {
    const transient = { message: "boom", code: "", details: "", hint: "" };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return adminAuth();
      if (isTranslationsTable(url)) return json(transient, 500); // insert de traducciones: error transitorio
      if (method === "DELETE") return json(transient, 500); // rollback del plan: también falla
      return json(PLAN_ROW, 201); // insert del plan: OK
    }) as unknown as typeof fetch;

    // Capturamos el log estructurado y restauramos ANTES de assertear (no dejar el spy filtrado).
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp().request("/admin/plans", createReq, ENV);
    const calls = errorSpy.mock.calls.slice();
    errorSpy.mockRestore();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    // El plan huérfano se logueó como evento estructurado (§12) con el id y SIN datos sensibles (§5).
    expect(calls).toHaveLength(1);
    const logged = JSON.parse(calls[0]?.[0] as string) as {
      level: string;
      event: string;
      planId: number;
    };
    expect(logged).toEqual({ level: "error", event: "plan_rollback_failed", planId: 1 });
  });

  it("409 al actualizar a un (tipo, target mensual) que ya existe (par único)", async () => {
    const dup = { code: "23505", message: "duplicate", details: "", hint: "" };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return adminAuth();
      if (method === "PATCH") return json(dup, 409); // el UPDATE del plan choca con el par único
      return json([PLAN_DETAIL]); // getPlanDetail (existence check): el plan existe
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/plans/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ targetMonthlyPct: 50 }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("409 al eliminar un plan referenciado por asignaciones (FK violation)", async () => {
    mockFetchAdmin({ code: "23503", message: "fk violation", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/plans/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("503 al actualizar el plan durante un outage de Supabase (5xx no-duplicado)", async () => {
    const transient = { message: "boom", code: "", details: "", hint: "" };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return adminAuth();
      if (method === "PATCH") return json(transient, 500); // el UPDATE del plan falla por outage
      return json([PLAN_DETAIL]); // getPlanDetail (existence check): el plan existe
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/plans/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ targetMonthlyPct: 50 }),
      },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 al eliminar el plan durante un outage de Supabase (5xx no-FK)", async () => {
    mockFetchAdmin({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/plans/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
