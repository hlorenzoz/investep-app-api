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

const BOOK_ROW = {
  id: 1,
  slug: "libro-invertir-con-cabeza",
  name: "Invertir con Cabeza",
  description: "Guía práctica de inversión.",
  category: "book",
  gender: null,
  theme: null,
  // PostgREST serializa `numeric` como STRING JSON — el mock lo refleja para verificar
  // que el service lo convierte a number (regresión del bug de `price` string).
  price: "19.99",
  currency: "USD",
  amazon_url: null,
  image: "store/ebooks/tmpjficd54i.webp",
  active: true,
  created_at: "2026-07-06T12:00:00.000Z",
  updated_at: "2026-07-06T12:00:00.000Z",
};

const TSHIRT_ROW = {
  id: 2,
  slug: "remera-toro-dark",
  name: "Remera Toro Dark",
  description: null,
  category: "tshirt",
  gender: "women",
  theme: "dark",
  price: "29.99",
  currency: "USD",
  amazon_url: null,
  image: "store/shirts/tmp25sy945t.webp",
  active: true,
  created_at: "2026-07-06T12:00:00.000Z",
  updated_at: "2026-07-06T12:00:00.000Z",
};

const AUTH = { Authorization: "Bearer t" };

describe("Tienda (cliente)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token en GET /tienda", async () => {
    const res = await createApp().request("/tienda", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 lista productos en camelCase", async () => {
    mockFetch([BOOK_ROW]);
    const res = await createApp().request("/tienda", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<Record<string, unknown>> };
    expect(body.products[0]).toEqual({
      id: 1,
      slug: "libro-invertir-con-cabeza",
      name: "Invertir con Cabeza",
      description: "Guía práctica de inversión.",
      category: "book",
      gender: null,
      theme: null,
      price: 19.99,
      currency: "USD",
      amazonUrl: null,
      image: "store/ebooks/tmpjficd54i.webp",
      active: true,
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
    });
  });

  it("REGRESIÓN: `price` se devuelve como number aunque PostgREST lo serialice string", async () => {
    mockFetch([BOOK_ROW]); // BOOK_ROW.price === "19.99" (string, como PostgREST real)
    const res = await createApp().request("/tienda", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ price: unknown }> };
    expect(typeof body.products[0]?.price).toBe("number");
    expect(body.products[0]?.price).toBe(19.99);
  });

  it("200 filtra por category=tshirt", async () => {
    mockFetch([TSHIRT_ROW]);
    const res = await createApp().request("/tienda?category=tshirt", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ category: string }> };
    expect(body.products).toHaveLength(1);
    const [first] = body.products;
    expect(first?.category).toBe("tshirt");
  });

  it("200 filtra combinando gender=women&theme=dark", async () => {
    mockFetch([TSHIRT_ROW]);
    const res = await createApp().request(
      "/tienda?category=tshirt&gender=women&theme=dark",
      { headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ gender: string; theme: string }> };
    const [first] = body.products;
    expect(first?.gender).toBe("women");
    expect(first?.theme).toBe("dark");
  });

  it("200 filtra por active=false", async () => {
    const inactiveRow = { ...BOOK_ROW, active: false };
    mockFetch([inactiveRow]);
    const res = await createApp().request("/tienda?active=false", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ active: boolean }> };
    expect(body.products).toHaveLength(1);
    const [first] = body.products;
    expect(first?.active).toBe(false);
  });

  it("200 obtiene un producto por slug", async () => {
    mockFetch([BOOK_ROW]);
    const res = await createApp().request(
      "/tienda/libro-invertir-con-cabeza",
      { headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { slug: string } };
    expect(body.product.slug).toBe("libro-invertir-con-cabeza");
  });

  it("200 resuelve producto con slug numérico (fallback id→slug)", async () => {
    const numericSlugRow = { ...BOOK_ROW, slug: "123" };
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
      const body = url.includes("slug=") ? [numericSlugRow] : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await createApp().request("/tienda/123", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { slug: string } };
    expect(body.product.slug).toBe("123");
  });

  it("404 cuando el producto no existe", async () => {
    mockFetch([], 200);
    const res = await createApp().request("/tienda/999", { headers: AUTH }, ENV);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("Tienda (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const CREATE_BOOK_BODY = {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      slug: "libro-invertir-con-cabeza",
      name: "Invertir con Cabeza",
      category: "book",
      price: 19.99,
    }),
  };

  it("403 cuando el usuario autenticado no es admin (mutación denegada)", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: false });
    const res = await createApp().request("/admin/tienda", CREATE_BOOK_BODY, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("201 crea un producto book (price, sin amazonUrl)", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: true });
    const res = await createApp().request("/admin/tienda", CREATE_BOOK_BODY, ENV);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { product: { slug: string; price: number | null } };
    expect(body.product.slug).toBe("libro-invertir-con-cabeza");
    expect(body.product.price).toBe(19.99);
  });

  it("201 crea un producto tshirt (gender+theme+price)", async () => {
    mockFetch(TSHIRT_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "remera-toro-dark",
          name: "Remera Toro Dark",
          category: "tshirt",
          gender: "women",
          theme: "dark",
          price: 29.99,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { product: { gender: string | null; theme: string | null } };
    expect(body.product.gender).toBe("women");
    expect(body.product.theme).toBe("dark");
  });

  it("422 al crear sin price ni amazonUrl", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "libro-sin-precio",
          name: "Libro Sin Precio",
          category: "book",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 al crear con gender en category='book'", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "libro-invalido",
          name: "Libro Inválido",
          category: "book",
          price: 19.99,
          gender: "men",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("409 cuando el slug ya existe", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request("/admin/tienda", CREATE_BOOK_BODY, ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 cuando PostgREST devuelve 23514 (CHECK violation, defense-in-depth)", async () => {
    mockFetch({ code: "23514", message: "check violation", details: "", hint: "" }, 400, {
      isAdmin: true,
    });
    const res = await createApp().request("/admin/tienda", CREATE_BOOK_BODY, ENV);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("200 actualiza un producto (PATCH parcial) siendo admin", async () => {
    mockFetch([{ ...BOOK_ROW, price: "24.99" }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ price: 24.99 }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { price: number | null } };
    expect(body.product.price).toBe(24.99);
  });

  it("404 al actualizar un producto inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("409 al actualizar con slug duplicado", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/tienda/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ slug: "remera-toro-dark" }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("200 con PATCH vacío devuelve el estado actual", async () => {
    mockFetch([BOOK_ROW], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/1",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { id: number } };
    expect(body.product.id).toBe(1);
  });

  it("404 con PATCH vacío sobre un producto inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("503 al actualizar durante un outage de Supabase (5xx no-duplicado)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/1",
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

  it("200 elimina un producto siendo admin", async () => {
    mockFetch([{ id: 1 }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("404 al eliminar un producto inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("503 cuando Supabase está caído (outage transitorio en create)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request("/admin/tienda", CREATE_BOOK_BODY, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 al eliminar durante un outage de Supabase", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/tienda/1",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
