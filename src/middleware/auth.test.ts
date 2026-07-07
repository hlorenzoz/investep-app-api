import { afterEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../lib/errors";
import type { AuthedBindings, AuthUser } from "../types/app";
import type { Env } from "../types/env";
import {
  createAuthMiddleware,
  extractBearerToken,
  type TokenVerifier,
  verifySupabaseToken,
} from "./auth";

const ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

const FAKE_USER: AuthUser = {
  id: "uid-1",
  email: "user@example.com",
  mustResetPassword: false,
  isAdmin: false,
  isManager: false,
  role: "user",
};

/** App Hono mínima para ejercitar el middleware con un verificador inyectado. */
function makeApp(verify: TokenVerifier) {
  const app = new Hono<AuthedBindings>();
  // onError mínimo: convierte el AppError que lanza el middleware en respuesta JSON.
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    throw err;
  });
  app.use("/me", createAuthMiddleware(verify));
  app.get("/me", (c) => c.json({ user: c.get("user") }, 200));
  return app;
}

describe("extractBearerToken", () => {
  it("devuelve null si no hay header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("devuelve null si el esquema no es Bearer", () => {
    expect(extractBearerToken("Token abc")).toBeNull();
  });

  it("devuelve null si el Bearer viene vacío", () => {
    expect(extractBearerToken("Bearer    ")).toBeNull();
  });

  it("extrae y recorta el token de un header Bearer válido", () => {
    expect(extractBearerToken("Bearer  abc.def.ghi ")).toBe("abc.def.ghi");
  });
});

// --- verifySupabaseToken (getClaims + fallback getUser) ---

/** Codifica un objeto como segmento base64url de un JWT. */
function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Arma un JWT HS256 con firma dummy. getClaims NO puede verificar HS256 localmente,
 * así que delega en getUser (red) — que acá está mockeado. La identidad resultante
 * sale de los claims del payload.
 */
function makeFakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.${Buffer.from("sig").toString("base64url")}`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

/** Mockea el fetch global para GoTrue: `/auth/v1/user` con la respuesta dada y el
 * endpoint JWKS con un set vacío (como en prod sin signing keys asimétricas → getClaims
 * cae a getUser). */
function mockAuthFetch(response: () => Response | Promise<Response>) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    if (url.includes("/auth/v1/user")) {
      return response();
    }
    return new Response("Not Mocked", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("verifySupabaseToken", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("JWT HS256 válido: construye el usuario desde los claims del payload", async () => {
    mockAuthFetch(
      () =>
        new Response(JSON.stringify({ id: "uid-jwt", email: "claims@example.com" }), {
          status: 200,
        }),
    );
    const token = makeFakeJwt({
      sub: "uid-jwt",
      email: "claims@example.com",
      app_metadata: { role: "admin" },
      exp: FUTURE_EXP,
    });

    const user = await verifySupabaseToken(ENV, token);

    expect(user).not.toBeNull();
    expect(user?.id).toBe("uid-jwt");
    expect(user?.email).toBe("claims@example.com");
    expect(user?.isAdmin).toBe(true);
    expect(user?.role).toBe("admin");
  });

  it("JWT válido pero rechazado por GoTrue (401) → null", async () => {
    mockAuthFetch(() => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));
    const token = makeFakeJwt({ sub: "uid-x", email: "x@example.com", exp: FUTURE_EXP });

    expect(await verifySupabaseToken(ENV, token)).toBeNull();
  });

  it("JWT sin email en los claims → null", async () => {
    mockAuthFetch(() => new Response(JSON.stringify({ id: "uid-x" }), { status: 200 }));
    const token = makeFakeJwt({ sub: "uid-x", exp: FUTURE_EXP });

    expect(await verifySupabaseToken(ENV, token)).toBeNull();
  });

  it("JWT expirado: cae al fallback getUser autoritativo → null si GoTrue rechaza", async () => {
    mockAuthFetch(() => new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    const token = makeFakeJwt({
      sub: "uid-x",
      email: "x@example.com",
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    expect(await verifySupabaseToken(ENV, token)).toBeNull();
  });

  it("token opaco (no JWT): cae al fallback getUser y respeta su respuesta", async () => {
    mockAuthFetch(
      () =>
        new Response(
          JSON.stringify({ id: "uid-opaque", email: "opaque@example.com", app_metadata: {} }),
          { status: 200 },
        ),
    );

    const user = await verifySupabaseToken(ENV, "token-opaco-de-test");

    expect(user?.id).toBe("uid-opaque");
    expect(user?.role).toBe("user");
  });

  it("token base64url con contenido NO-JSON: 401 vía fallback, nunca 500", async () => {
    // Regresión: getClaims LANZA SyntaxError (no AuthError) al decodificar esto;
    // sin el try/catch el request terminaba en 500 INTERNAL_ERROR.
    mockAuthFetch(() => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));

    expect(await verifySupabaseToken(ENV, "aaa.bbb.ccc")).toBeNull();
  });

  it("token con alg desconocido: 401 vía fallback autoritativo, nunca 5xx", async () => {
    mockAuthFetch(() => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));
    const header = Buffer.from(JSON.stringify({ alg: "XX999", typ: "JWT", kid: "k1" })).toString(
      "base64url",
    );
    const payload = b64url({ sub: "u1", email: "a@b.c", exp: FUTURE_EXP });
    const token = `${header}.${payload}.${Buffer.from("sig").toString("base64url")}`;

    expect(await verifySupabaseToken(ENV, token)).toBeNull();
  });

  it("503 SERVICE_UNAVAILABLE si GoTrue no responde (no un 401 espurio)", async () => {
    mockAuthFetch(() => {
      throw new TypeError("network down");
    });

    expect(verifySupabaseToken(ENV, "cualquier-token")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });
});

describe("createAuthMiddleware", () => {
  it("401 UNAUTHORIZED cuando falta el token", async () => {
    const app = makeApp(async () => FAKE_USER);

    const res = await app.request("/me", {}, ENV);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 UNAUTHORIZED cuando el verificador rechaza el token", async () => {
    const app = makeApp(async () => null);

    const res = await app.request("/me", { headers: { Authorization: "Bearer bad" } }, ENV);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("200 y expone el usuario cuando el verificador acepta el token", async () => {
    const app = makeApp(async () => FAKE_USER);

    const res = await app.request("/me", { headers: { Authorization: "Bearer good" } }, ENV);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AuthUser };
    expect(body.user.id).toBe("uid-1");
    expect(body.user.email).toBe("user@example.com");
  });
});
