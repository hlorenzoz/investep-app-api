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
 * Mock de fetch que enruta: el endpoint de auth devuelve un usuario válido (admin o no
 * según `isAdmin`, vía `app_metadata.is_admin`); cualquier otra llamada (PostgREST)
 * devuelve `restBody` con `restStatus`.
 */
function mockFetch(restBody: unknown, restStatus = 200, opts: { isAdmin?: boolean } = {}) {
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

const BROKER_ROW = {
  id: 2,
  slug: "interactive-brokers",
  name: "Interactive Brokers",
  url: "https://www.interactivebrokers.com/",
  url_secondary: "https://www.interactivebrokers.ie/",
  logo: "https://x/logo.svg",
  favicon: null,
  icon: null,
};

const AUTH = { Authorization: "Bearer t" };

describe("Brokers (cliente)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token en GET /brokers", async () => {
    const res = await createApp().request("/brokers", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 lista los brokers en camelCase", async () => {
    mockFetch([BROKER_ROW]);
    const res = await createApp().request("/brokers", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brokers: Array<Record<string, unknown>> };
    expect(body.brokers[0]).toEqual({
      id: 2,
      slug: "interactive-brokers",
      name: "Interactive Brokers",
      url: "https://www.interactivebrokers.com/",
      urlSecondary: "https://www.interactivebrokers.ie/",
      logo: "https://x/logo.svg",
      favicon: null,
      icon: null,
    });
  });

  it("200 obtiene un broker por slug", async () => {
    mockFetch([BROKER_ROW]);
    const res = await createApp().request("/brokers/interactive-brokers", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { broker: { slug: string } };
    expect(body.broker.slug).toBe("interactive-brokers");
  });

  it("404 cuando el broker no existe", async () => {
    mockFetch([], 200);
    const res = await createApp().request("/brokers/999", { headers: AUTH }, ENV);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("200 resuelve un broker con slug numérico (fallback id→slug)", async () => {
    const numericSlugRow = { ...BROKER_ROW, slug: "123" };
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({
            id: "uid-1",
            email: "u@example.com",
            user_metadata: {},
            app_metadata: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // La consulta por id no matchea; la consulta por slug sí.
      const body = url.includes("slug=") ? [numericSlugRow] : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await createApp().request("/brokers/123", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { broker: { slug: string } };
    expect(resBody.broker.slug).toBe("123");
  });
});

describe("Brokers (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const CREATE_BODY = {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ slug: "etrade", name: "eTrade", url: "https://us.etrade.com/" }),
  };

  it("403 cuando el usuario autenticado no es admin", async () => {
    mockFetch(BROKER_ROW, 201, { isAdmin: false });
    const res = await createApp().request("/admin/brokers", CREATE_BODY, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("201 crea un broker siendo admin", async () => {
    mockFetch({ ...BROKER_ROW, slug: "etrade", name: "eTrade" }, 201, { isAdmin: true });
    const res = await createApp().request("/admin/brokers", CREATE_BODY, ENV);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { broker: { slug: string } };
    expect(body.broker.slug).toBe("etrade");
  });

  it("409 cuando el slug ya existe", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request("/admin/brokers", CREATE_BODY, ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 ante un slug inválido", async () => {
    mockFetch(BROKER_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ slug: "Bad Slug!", name: "x", url: "https://x.com" }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("200 actualiza un broker siendo admin", async () => {
    mockFetch([{ ...BROKER_ROW, name: "IBKR" }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/2",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ name: "IBKR" }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { broker: { name: string } };
    expect(body.broker.name).toBe("IBKR");
  });

  it("404 al actualizar un broker inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("200 elimina un broker siendo admin", async () => {
    mockFetch([{ id: 2 }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/2",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("404 al eliminar un broker inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  // --- Ramas de error / resiliencia / integridad ---

  it("503 cuando Supabase está caído al crear (5xx transitorio, no es slug duplicado)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request("/admin/brokers", CREATE_BODY, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("409 al actualizar con un slug ya en uso por otro broker", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/brokers/2",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ slug: "etrade" }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("200 con PATCH vacío devuelve el estado actual del broker", async () => {
    mockFetch([BROKER_ROW], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/2",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { broker: { id: number } };
    expect(body.broker.id).toBe(2);
  });

  it("404 con PATCH vacío sobre un broker inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("409 al eliminar un broker referenciado por asignaciones (FK violation)", async () => {
    mockFetch({ code: "23503", message: "fk violation", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/brokers/2",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("503 al actualizar durante un outage de Supabase (5xx no-duplicado)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/2",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 al eliminar durante un outage de Supabase (5xx no-FK)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/brokers/2",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
