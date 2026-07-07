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
  id: 12,
  slug: "habitos-atomicos",
  title: "Hábitos atómicos",
  author: "James Clear",
  description:
    "Un enfoque práctico sobre cómo los pequeños hábitos diarios generan grandes cambios.",
  url: "https://www.youtube.com/results?search_query=habitos+atomicos+audiolibro+espanol",
  image: "books/habitos-atomicos.webp",
  sort_order: 12,
};

const AUTH = { Authorization: "Bearer t" };

describe("Recommended books (cliente)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token en GET /recommended-books", async () => {
    const res = await createApp().request("/recommended-books", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("200 lista los libros en camelCase (sort_order → sortOrder)", async () => {
    mockFetch([BOOK_ROW]);
    const res = await createApp().request("/recommended-books", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendedBooks: Array<Record<string, unknown>> };
    expect(body.recommendedBooks[0]).toEqual({
      id: 12,
      slug: "habitos-atomicos",
      title: "Hábitos atómicos",
      author: "James Clear",
      description:
        "Un enfoque práctico sobre cómo los pequeños hábitos diarios generan grandes cambios.",
      url: "https://www.youtube.com/results?search_query=habitos+atomicos+audiolibro+espanol",
      image: "books/habitos-atomicos.webp",
      sortOrder: 12,
    });
  });

  it("200 obtiene un libro por slug", async () => {
    mockFetch([BOOK_ROW]);
    const res = await createApp().request(
      "/recommended-books/habitos-atomicos",
      { headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendedBook: { slug: string } };
    expect(body.recommendedBook.slug).toBe("habitos-atomicos");
  });

  it("404 cuando el libro no existe", async () => {
    mockFetch([], 200);
    const res = await createApp().request("/recommended-books/999", { headers: AUTH }, ENV);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("200 resuelve un libro con slug numérico (fallback id→slug)", async () => {
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
      // La consulta por id no matchea; la consulta por slug sí.
      const body = url.includes("slug=") ? [numericSlugRow] : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await createApp().request("/recommended-books/123", { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { recommendedBook: { slug: string } };
    expect(resBody.recommendedBook.slug).toBe("123");
  });
});

describe("Recommended books (admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const CREATE_BODY = {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      slug: "el-secreto",
      title: "El Secreto",
      author: "Rhonda Byrne",
      description: "Populariza la Ley de la Atracción.",
      url: "https://www.youtube.com/results?search_query=el+secreto",
      image: "books/el-secreto.jpeg",
      sortOrder: 5,
    }),
  };

  it("403 cuando el usuario autenticado no es admin", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: false });
    const res = await createApp().request("/admin/recommended-books", CREATE_BODY, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("201 crea un libro siendo admin", async () => {
    mockFetch({ ...BOOK_ROW, slug: "el-secreto", title: "El Secreto" }, 201, { isAdmin: true });
    const res = await createApp().request("/admin/recommended-books", CREATE_BODY, ENV);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { recommendedBook: { slug: string } };
    expect(body.recommendedBook.slug).toBe("el-secreto");
  });

  it("409 cuando el slug ya existe", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request("/admin/recommended-books", CREATE_BODY, ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("422 ante un slug inválido", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "Bad Slug!",
          title: "x",
          author: "y",
          description: "z",
          url: "https://x.com",
          image: "books/x.webp",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("422 ante una url no válida", async () => {
    mockFetch(BOOK_ROW, 201, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "x",
          title: "x",
          author: "y",
          description: "z",
          url: "no-es-una-url",
          image: "books/x.webp",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("200 actualiza un libro siendo admin", async () => {
    mockFetch([{ ...BOOK_ROW, title: "Atomic Habits" }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ title: "Atomic Habits" }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendedBook: { title: string } };
    expect(body.recommendedBook.title).toBe("Atomic Habits");
  });

  it("404 al actualizar un libro inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/999",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("200 elimina un libro siendo admin", async () => {
    mockFetch([{ id: 12 }], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("404 al eliminar un libro inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/999",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  // --- Ramas de error / resiliencia / integridad ---

  it("503 cuando Supabase está caído al crear (5xx transitorio, no es slug duplicado)", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request("/admin/recommended-books", CREATE_BODY, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("422 al crear si la DB rechaza un CHECK (p. ej. url no-http, defense-in-depth)", async () => {
    mockFetch({ code: "23514", message: "check violation", details: "", hint: "" }, 400, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/recommended-books",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "un-libro",
          title: "Un libro",
          author: "Autor",
          description: "desc",
          url: "ftp://example.com/x",
          image: "books/x.webp",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 al actualizar si la DB rechaza un CHECK (defense-in-depth)", async () => {
    mockFetch({ code: "23514", message: "check violation", details: "", hint: "" }, 400, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ url: "ftp://example.com/x" }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("409 al actualizar con un slug ya en uso por otro libro", async () => {
    mockFetch({ code: "23505", message: "duplicate key", details: "", hint: "" }, 409, {
      isAdmin: true,
    });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ slug: "el-secreto" }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("200 con PATCH vacío devuelve el estado actual del libro", async () => {
    mockFetch([BOOK_ROW], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendedBook: { id: number } };
    expect(body.recommendedBook.id).toBe(12);
  });

  it("404 con PATCH vacío sobre un libro inexistente", async () => {
    mockFetch([], 200, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/999",
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
      "/admin/recommended-books/12",
      {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("503 al eliminar durante un outage de Supabase", async () => {
    mockFetch({ message: "boom", code: "", details: "", hint: "" }, 500, { isAdmin: true });
    const res = await createApp().request(
      "/admin/recommended-books/12",
      { method: "DELETE", headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
