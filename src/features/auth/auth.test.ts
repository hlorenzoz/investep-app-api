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
 * Simula la respuesta del endpoint GoTrue `GET /auth/v1/user` que consume
 * internamente `supabase.auth.getUser(token)`. El cuerpo ES el usuario.
 */
function mockGoTrueUser(user: Record<string, unknown>) {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("GET /auth/me", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin header Authorization", async () => {
    const res = await createApp().request("/auth/me", {}, ENV);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 cuando Supabase rechaza el token", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer invalid" } },
      ENV,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("200 con el usuario cuando el token es válido", async () => {
    mockGoTrueUser({
      id: "uid-123",
      email: "user@example.com",
      user_metadata: { must_reset_password: false },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; mustResetPassword: boolean };
    };
    expect(body.user.id).toBe("uid-123");
    expect(body.user.email).toBe("user@example.com");
    expect(body.user.mustResetPassword).toBe(false);
  });

  it("expone mustResetPassword: true cuando el metadata lo indica", async () => {
    mockGoTrueUser({
      id: "uid-456",
      email: "reset@example.com",
      user_metadata: { must_reset_password: true },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { mustResetPassword: boolean } };
    expect(body.user.mustResetPassword).toBe(true);
  });

  it("401 cuando el usuario no tiene email", async () => {
    mockGoTrueUser({ id: "uid-789", user_metadata: {} });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it("503 (no 401) cuando no se puede verificar contra Supabase (red caída / outage)", async () => {
    // fetch que falla → supabase-js lo envuelve en AuthRetryableFetchError.
    // Un token VÁLIDO no debe convertirse en 401 (deslogueo espurio) ante un fallo de infra.
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    // supabase-js loguea el fallo de fetch con console.error; lo silenciamos para no
    // ensuciar la salida del test (no es un error del test, es ruido del SDK).
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );
    errorSpy.mockRestore();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
