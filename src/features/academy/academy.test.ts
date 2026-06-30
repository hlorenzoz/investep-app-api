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

const AUTH = { Authorization: "Bearer t" };

/** Respuesta JSON helper (PostgREST-like). */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Respuesta del endpoint de validación de token (admin o no, vía `app_metadata.is_admin`). */
const userResponse = (isAdmin: boolean) =>
  json({
    id: "uid-1",
    email: "u@example.com",
    user_metadata: {},
    app_metadata: isAdmin ? { is_admin: true } : {},
  });

/** Rutea por el PATH de la tabla destino (no por substring de la URL completa). */
const pathEndsWith = (url: string, suffix: string) => new URL(url).pathname.endsWith(suffix);

/** Extrae los valores de un filtro PostgREST `.in()`: `col=in.(a,b)` → `["a","b"]`. */
const parseInFilter = (url: string, column: string): string[] =>
  (new URL(url).searchParams.get(column) ?? "")
    .replace(/^in\./, "")
    .replace(/[()"]/g, "")
    .split(",")
    .filter(Boolean);

// --- Fixtures ---

const CLIENT_ROWS = [
  {
    id: 3,
    slug: "gold",
    url: "https://stripe.com/pay/gold",
    price_regular: "199.00",
    price_offer: "149.00",
    currency: "USD",
    sort_order: 3,
    investep_plan_translations: [
      { locale: "es", name: "Gold", subtitle: "Para traders activos" },
      { locale: "en", name: "Gold", subtitle: "For active traders" },
    ],
    investep_plan_features: [
      // A propósito desordenadas: el service debe ordenarlas por sort_order (1 antes que 2).
      {
        investep_features: {
          id: 2,
          slug: "live_sessions",
          sort_order: 2,
          investep_feature_translations: [{ locale: "es", label: "Sesiones en vivo" }],
        },
      },
      {
        investep_features: {
          id: 1,
          slug: "community",
          sort_order: 1,
          investep_feature_translations: [{ locale: "es", label: "Comunidad" }],
        },
      },
    ],
  },
];

const ADMIN_ROW = {
  id: 3,
  slug: "gold",
  url: "https://stripe.com/pay/gold",
  price_regular: "199.00",
  price_offer: null,
  currency: "USD",
  sort_order: 3,
  is_active: false,
  investep_plan_translations: [{ locale: "es", name: "Gold", subtitle: null }],
  investep_plan_features: [{ investep_feature_id: 1 }, { investep_feature_id: 2 }],
};

const CREATE_PAYLOAD = {
  slug: "gold",
  url: "https://stripe.com/pay/gold",
  priceRegular: 199,
  priceOffer: 149,
  currency: "USD",
  sortOrder: 3,
  isActive: true,
  translations: [{ locale: "es", name: "Gold", subtitle: "Para traders activos" }],
  featureIds: [1, 2],
};

const createReq = (payload: unknown) => ({
  method: "POST",
  headers: { ...AUTH, "content-type": "application/json" },
  body: JSON.stringify(payload),
});

describe("GET /academy/plans (cliente)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockClient(restBody: unknown, restStatus = 200) {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(false);
      return json(restBody, restStatus);
    }) as unknown as typeof fetch;
  }

  it("401 sin token", async () => {
    const res = await createApp().request("/academy/plans", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 lista paquetes activos con locale, features ordenadas y precios coercidos", async () => {
    mockClient(CLIENT_ROWS);

    const res = await createApp().request("/academy/plans?locale=es", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      locale: string;
      plans: {
        id: number;
        slug: string;
        name: string | null;
        subtitle: string | null;
        url: string | null;
        priceRegular: number;
        priceOffer: number | null;
        currency: string;
        features: { id: number; slug: string; label: string | null }[];
      }[];
    };

    expect(body.locale).toBe("es");
    const plan = body.plans[0];
    expect(plan).toMatchObject({
      id: 3,
      slug: "gold",
      name: "Gold",
      subtitle: "Para traders activos",
      url: "https://stripe.com/pay/gold",
      priceRegular: 199,
      priceOffer: 149,
      currency: "USD",
    });
    // Features ordenadas por sort_order (community=1 antes que live_sessions=2) y label del locale.
    expect(plan?.features).toEqual([
      { id: 1, slug: "community", label: "Comunidad" },
      { id: 2, slug: "live_sessions", label: "Sesiones en vivo" },
    ]);
  });

  it("usa locale 'es' por defecto cuando no se pasa", async () => {
    mockClient(CLIENT_ROWS);
    const res = await createApp().request("/academy/plans", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { locale: string };
    expect(body.locale).toBe("es");
  });

  it("name/subtitle/label en null cuando no hay traducción del locale pedido", async () => {
    mockClient(CLIENT_ROWS);
    const res = await createApp().request("/academy/plans?locale=fr", { headers: AUTH }, ENV);
    const body = (await res.json()) as {
      plans: {
        name: string | null;
        subtitle: string | null;
        features: { label: string | null }[];
      }[];
    };
    expect(body.plans[0]?.name).toBeNull();
    expect(body.plans[0]?.subtitle).toBeNull();
    expect(body.plans[0]?.features[0]?.label).toBeNull();
  });

  it("503 cuando Supabase está caído (5xx transitorio)", async () => {
    mockClient({ message: "boom", code: "", details: "", hint: "" }, 500);
    const res = await createApp().request("/academy/plans", { headers: AUTH }, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("Academy plans (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("403 cuando el usuario no es admin", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(false);
      return json([], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", { headers: AUTH }, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("200 lista todos los paquetes con traducciones e ids de features", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([ADMIN_ROW], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plans: {
        id: number;
        isActive: boolean;
        sortOrder: number;
        url: string | null;
        translations: { locale: string; name: string }[];
        featureIds: number[];
      }[];
    };
    expect(body.plans[0]).toMatchObject({
      id: 3,
      isActive: false,
      sortOrder: 3,
      url: "https://stripe.com/pay/gold",
    });
    expect(body.plans[0]?.featureIds).toEqual([1, 2]);
    expect(body.plans[0]?.translations[0]?.name).toBe("Gold");
  });

  it("201 crea un paquete (precios coercidos, features y traducciones)", async () => {
    const scalar = {
      id: 10,
      slug: "gold",
      url: "https://stripe.com/pay/gold",
      price_regular: "199.00",
      price_offer: "149.00",
      currency: "USD",
      sort_order: 3,
      is_active: true,
    };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_plan_translations")) return json(null, 201);
      if (pathEndsWith(url, "/investep_plan_features")) return json(null, 201);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      plan: {
        id: number;
        url: string | null;
        priceRegular: number;
        priceOffer: number | null;
        featureIds: number[];
      };
    };
    expect(body.plan.id).toBe(10);
    expect(body.plan.url).toBe("https://stripe.com/pay/gold");
    expect(body.plan.priceRegular).toBe(199);
    expect(body.plan.priceOffer).toBe(149);
    expect(body.plan.featureIds).toEqual([1, 2]);
  });

  it("409 cuando el slug ya existe", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST")
        return json({ code: "23505", message: "duplicate", details: "", hint: "" }, 409);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 cuando un featureId no existe (FK violation) y hace rollback del plan", async () => {
    const scalar = {
      id: 11,
      slug: "gold",
      price_regular: "199.00",
      price_offer: null,
      currency: "USD",
      sort_order: 0,
      is_active: true,
    };
    let deletedPlan = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_plans") && method === "DELETE") {
        deletedPlan = true;
        return json([{ id: 11 }], 200);
      }
      if (pathEndsWith(url, "/investep_plan_translations")) return json(null, 201);
      if (pathEndsWith(url, "/investep_plan_features"))
        return json({ code: "23503", message: "fk violation", details: "", hint: "" }, 409);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(deletedPlan).toBe(true); // rollback best-effort ejecutado
  });

  it("503 y emite evento estructurado si las traducciones fallan y el rollback también", async () => {
    const scalar = {
      id: 12,
      slug: "gold",
      price_regular: "199.00",
      price_offer: null,
      currency: "USD",
      sort_order: 0,
      is_active: true,
    };
    const transient = { message: "boom", code: "", details: "", hint: "" };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_plans") && method === "DELETE") return json(transient, 500); // rollback falla
      if (pathEndsWith(url, "/investep_plan_translations")) return json(transient, 500); // traducciones fallan
      return json(null, 200);
    }) as unknown as typeof fetch;

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    const calls = errorSpy.mock.calls.slice();
    errorSpy.mockRestore();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(calls).toHaveLength(1);
    const logged = JSON.parse(calls[0]?.[0] as string) as {
      level: string;
      event: string;
      planId: number;
    };
    expect(logged).toEqual({ level: "error", event: "academy_plan_rollback_failed", planId: 12 });
  });

  it("200 actualiza un paquete (scalar + reemplazo de features por diff)", async () => {
    // ADMIN_ROW tiene features [1,2]; el patch deja [5] → toAdd=[5], toRemove=[1,2].
    const featureInserts: number[] = [];
    let featureDeleteRemoved: number[] = [];
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET") return json([ADMIN_ROW], 200);
      if (pathEndsWith(url, "/investep_plan_features") && method === "POST") {
        const rows = JSON.parse(String(init?.body)) as { investep_feature_id: number }[];
        featureInserts.push(...rows.map((r) => r.investep_feature_id));
        return json(null, 201);
      }
      if (pathEndsWith(url, "/investep_plan_features") && method === "DELETE") {
        featureDeleteRemoved = parseInFilter(url, "investep_feature_id").map(Number);
        return json(null, 200);
      }
      return json(null, 200); // PATCH plan, upsert traducciones
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ priceRegular: 150, isActive: true, featureIds: [5] }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: { priceRegular: number; url: string | null; isActive: boolean; featureIds: number[] };
    };
    // El estado final se arma en memoria desde existing + patch (sin re-lectura).
    expect(body.plan.priceRegular).toBe(150);
    expect(body.plan.url).toBe("https://stripe.com/pay/gold");
    expect(body.plan.isActive).toBe(true);
    expect(body.plan.featureIds).toEqual([5]);
    // Diff: insertó solo la nueva (5) y borró solo las quitadas (1,2).
    expect(featureInserts).toEqual([5]);
    expect(featureDeleteRemoved).toEqual([1, 2]);
  });

  it("#1: un featureId inválido en PATCH devuelve 422 SIN borrar las features actuales", async () => {
    let featureDeleteCalled = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET") return json([ADMIN_ROW], 200);
      if (pathEndsWith(url, "/investep_plan_features") && method === "POST")
        return json({ code: "23503", message: "fk violation", details: "", hint: "" }, 409);
      if (pathEndsWith(url, "/investep_plan_features") && method === "DELETE") {
        featureDeleteCalled = true;
        return json(null, 200);
      }
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ featureIds: [999999] }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    // Insert-before-delete: el insert falla primero, así que NUNCA se borraron las features actuales.
    expect(featureDeleteCalled).toBe(false);
  });

  it("#5: PATCH de traducciones reemplaza el set — borra el locale omitido", async () => {
    // ADMIN_ROW tiene traducciones [es]; mandamos solo [en] → upsert en + borrar es.
    const existingTwoLocales = {
      ...ADMIN_ROW,
      investep_plan_translations: [
        { locale: "es", name: "Gold", subtitle: null },
        { locale: "en", name: "Gold EN", subtitle: null },
      ],
    };
    let removedLocales: string[] = [];
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET")
        return json([existingTwoLocales], 200);
      if (pathEndsWith(url, "/investep_plan_translations") && method === "DELETE") {
        removedLocales = parseInFilter(url, "locale");
        return json(null, 200);
      }
      return json(null, 200); // upsert traducciones (POST), PATCH plan
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ translations: [{ locale: "en", name: "Gold EN" }] }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { translations: { locale: string }[] } };
    // Borró el locale que ya no viene (es) y dejó exactamente lo enviado (en).
    expect(removedLocales).toEqual(["es"]);
    expect(body.plan.translations.map((t) => t.locale)).toEqual(["en"]);
  });

  // --- Validación de input (422 ANTES de tocar la DB): #2 locales dup, #3 precio, #7 sortOrder ---

  function adminOnlyFetch() {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json(null, 200);
    }) as unknown as typeof fetch;
  }

  it("#2: 422 cuando el create trae locales duplicados en translations", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans",
      createReq({
        ...CREATE_PAYLOAD,
        translations: [
          { locale: "es", name: "A" },
          { locale: "es", name: "B" },
        ],
      }),
      ENV,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("#2: 422 cuando el PATCH trae locales duplicados en translations", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          translations: [
            { locale: "en", name: "A" },
            { locale: "en", name: "B" },
          ],
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("#3: 422 cuando priceRegular excede numeric(10,2) (overflow)", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans",
      createReq({ ...CREATE_PAYLOAD, priceRegular: 100_000_000 }),
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("#3: 422 cuando priceRegular tiene más de 2 decimales (numeric(10,2) redondearía)", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans",
      createReq({ ...CREATE_PAYLOAD, priceRegular: 19.999 }),
      ENV,
    );
    // Rechazar acá evita que el PATCH (que arma la respuesta en memoria) devuelva un precio
    // distinto al que la DB realmente guarda tras redondear.
    expect(res.status).toBe(422);
  });

  it("#7: 422 cuando sortOrder es negativo", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans",
      createReq({ ...CREATE_PAYLOAD, sortOrder: -1 }),
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("422 cuando url es malformada en creación", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans",
      createReq({ ...CREATE_PAYLOAD, url: "invalid-url" }),
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("422 cuando url es malformada en actualización", async () => {
    adminOnlyFetch();
    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ url: "invalid-url" }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("404 al actualizar un paquete inexistente", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([], 200); // getAcademyPlanDetail vacío
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ priceRegular: 100 }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("422 al actualizar con un locale desconocido en las traducciones", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET") return json([ADMIN_ROW], 200);
      if (pathEndsWith(url, "/investep_plan_translations"))
        return json({ code: "23503", message: "fk violation", details: "", hint: "" }, 409);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ translations: [{ locale: "xx", name: "X" }] }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("200 elimina un paquete", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([{ id: 3 }], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("404 al eliminar un paquete inexistente", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("409 al eliminar un paquete referenciado por una membresía (FK violation)", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json({ code: "23503", message: "fk violation", details: "", hint: "" }, 409);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  // --- Ramas de error transitorio (outage de Supabase): paridad con plans ---

  it("503 cuando Supabase está caído al insertar el paquete (5xx transitorio)", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST")
        return json({ message: "boom", code: "", details: "", hint: "" }, 500);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 cuando el insert de features falla con un error no-FK (transitorio)", async () => {
    const scalar = {
      id: 13,
      slug: "gold",
      price_regular: "199.00",
      price_offer: null,
      currency: "USD",
      sort_order: 0,
      is_active: true,
    };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_plans") && method === "DELETE")
        return json([{ id: 13 }], 200);
      if (pathEndsWith(url, "/investep_plan_translations")) return json(null, 201);
      if (pathEndsWith(url, "/investep_plan_features"))
        return json({ message: "boom", code: "", details: "", hint: "" }, 500); // no-FK
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 al eliminar durante un outage de Supabase (5xx no-FK)", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json({ message: "boom", code: "", details: "", hint: "" }, 500);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("Academy plans (admin): authz por endpoint y casos límite (test:review)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Auth válido pero NO admin → requireAdmin debe cortar con 403 en CADA mutación.
  function nonAdminFetch() {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(false);
      return json(null, 200);
    }) as unknown as typeof fetch;
  }

  it("authz: 403 al CREAR siendo no-admin (la ruta vive bajo requireAdmin)", async () => {
    nonAdminFetch();
    const res = await createApp().request("/admin/academy/plans", createReq(CREATE_PAYLOAD), ENV);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("authz: 403 al ACTUALIZAR siendo no-admin", async () => {
    nonAdminFetch();
    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ priceRegular: 10 }),
      },
      ENV,
    );
    expect(res.status).toBe(403);
    // Fijamos el code: prueba que el 403 viene de requireAdmin (FORBIDDEN), no de otra capa.
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("authz: 403 al ELIMINAR siendo no-admin", async () => {
    nonAdminFetch();
    const res = await createApp().request(
      "/admin/academy/plans/3",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("límite (dinero): priceOffer null se mapea a null, NO a 0", async () => {
    // ADMIN_ROW.price_offer === null. Mata la mutación `Number(null)` (=0): un 'sin oferta'
    // que se convierta en 'oferta = 0' es un bug de precio.
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([ADMIN_ROW], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/plans", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plans: { priceOffer: number | null }[] };
    expect(body.plans[0]?.priceOffer).toBeNull();
  });

  it("límite: PATCH featureIds:[] vacía el set (borra todas, no inserta)", async () => {
    let removed: number[] = [];
    let insertCalled = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET") return json([ADMIN_ROW], 200);
      if (pathEndsWith(url, "/investep_plan_features") && method === "POST") {
        insertCalled = true;
        return json(null, 201);
      }
      if (pathEndsWith(url, "/investep_plan_features") && method === "DELETE") {
        removed = parseInFilter(url, "investep_feature_id").map(Number);
        return json(null, 200);
      }
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ featureIds: [] }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { featureIds: number[] } };
    expect(body.plan.featureIds).toEqual([]);
    expect(removed).toEqual([1, 2]); // borró TODAS las actuales (ADMIN_ROW tenía [1,2])
    expect(insertCalled).toBe(false); // y no insertó nada
  });

  it("happy: PATCH solo-escalar no toca traducciones ni features (las deja intactas)", async () => {
    let featuresTouched = false;
    let translationsTouched = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_plans") && method === "GET") return json([ADMIN_ROW], 200);
      if (pathEndsWith(url, "/investep_plan_features") && method !== "GET") featuresTouched = true;
      if (pathEndsWith(url, "/investep_plan_translations") && method !== "GET")
        translationsTouched = true;
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/plans/3",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { isActive: boolean; featureIds: number[] } };
    expect(body.plan.isActive).toBe(true);
    expect(body.plan.featureIds).toEqual([1, 2]); // intactas (no se enviaron en el patch)
    expect(featuresTouched).toBe(false);
    expect(translationsTouched).toBe(false);
  });
});

describe("Academy features (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const FEATURE_ROW = {
    id: 1,
    slug: "live_sessions",
    sort_order: 0,
    investep_feature_translations: [{ locale: "es", label: "Sesiones en vivo" }],
  };

  const CREATE_FEATURE_PAYLOAD = {
    slug: "live_sessions",
    sortOrder: 0,
    translations: [{ locale: "es", label: "Sesiones en vivo" }],
  };

  const createFeatureReq = (payload: unknown) => ({
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  it("403 cuando el usuario no es admin", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(false);
      return json([], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/features", { headers: AUTH }, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("200 lista todas las características con traducciones", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      return json([FEATURE_ROW], 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request("/admin/academy/features", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: {
        id: number;
        slug: string;
        sortOrder: number;
        translations: { locale: string; label: string }[];
      }[];
    };
    expect(body.features[0]).toMatchObject({ id: 1, slug: "live_sessions", sortOrder: 0 });
    expect(body.features[0]?.translations[0]?.label).toBe("Sesiones en vivo");
  });

  it("201 crea una característica", async () => {
    const scalar = {
      id: 5,
      slug: "live_sessions",
      sort_order: 0,
    };
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_feature_translations")) return json(null, 201);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features",
      createFeatureReq(CREATE_FEATURE_PAYLOAD),
      ENV,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      feature: {
        id: number;
        slug: string;
        sortOrder: number;
        translations: { locale: string; label: string }[];
      };
    };
    expect(body.feature.id).toBe(5);
    expect(body.feature.slug).toBe("live_sessions");
    expect(body.feature.translations[0]?.label).toBe("Sesiones en vivo");
  });

  it("409 cuando el slug ya existe", async () => {
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features") && method === "POST")
        return json({ code: "23505", message: "duplicate", details: "", hint: "" }, 409);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features",
      createFeatureReq(CREATE_FEATURE_PAYLOAD),
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 cuando un locale no existe y hace rollback", async () => {
    const scalar = {
      id: 6,
      slug: "live_sessions",
      sort_order: 0,
    };
    let deletedFeature = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features") && method === "POST") return json(scalar, 201);
      if (pathEndsWith(url, "/investep_features") && method === "DELETE") {
        deletedFeature = true;
        return json([{ id: 6 }], 200);
      }
      if (pathEndsWith(url, "/investep_feature_translations"))
        return json({ code: "23503", message: "fk violation", details: "", hint: "" }, 409);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features",
      createFeatureReq(CREATE_FEATURE_PAYLOAD),
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(deletedFeature).toBe(true);
  });

  it("200 actualiza orden y reemplaza traducciones en PATCH", async () => {
    const existingFeature = {
      id: 1,
      slug: "live_sessions",
      sort_order: 0,
      investep_feature_translations: [
        { locale: "es", label: "Sesiones en vivo" },
        { locale: "en", label: "Live sessions" },
      ],
    };
    let deleteCalled = false;
    let upsertCalled = false;

    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features") && method === "GET")
        return json([existingFeature], 200);
      if (pathEndsWith(url, "/investep_features") && method === "PATCH") return json(null, 200);
      if (pathEndsWith(url, "/investep_feature_translations") && method === "POST") {
        upsertCalled = true;
        return json(null, 201);
      }
      if (pathEndsWith(url, "/investep_feature_translations") && method === "DELETE") {
        deleteCalled = true;
        const locales = parseInFilter(url, "locale");
        expect(locales).toEqual(["en"]);
        return json(null, 200);
      }
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          sortOrder: 1,
          translations: [{ locale: "es", label: "Sesiones en vivo actualizadas" }],
        }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      feature: { id: number; sortOrder: number; translations: { locale: string; label: string }[] };
    };
    expect(body.feature.sortOrder).toBe(1);
    expect(body.feature.translations).toEqual([
      { locale: "es", label: "Sesiones en vivo actualizadas" },
    ]);
    expect(upsertCalled).toBe(true);
    expect(deleteCalled).toBe(true);
  });

  it("404 en PATCH si la característica no existe", async () => {
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features")) return json([], 200);
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ sortOrder: 1 }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("200 elimina característica y 404 si no existe", async () => {
    let deleteCalled = false;
    globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/v1/user")) return userResponse(true);
      if (pathEndsWith(url, "/investep_features") && method === "DELETE") {
        deleteCalled = true;
        const matches = url.match(/id=eq\.(\d+)/);
        if (matches?.[1] === "1") {
          return json([{ id: 1 }], 200);
        }
        return json([], 200);
      }
      return json(null, 200);
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/admin/academy/features/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);

    const res404 = await createApp().request(
      "/admin/academy/features/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res404.status).toBe(404);
  });
});
