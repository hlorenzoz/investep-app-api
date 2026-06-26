import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../lib/errors";
import type { AuthedBindings, AuthUser } from "../types/app";
import type { Env } from "../types/env";
import { createAuthMiddleware, extractBearerToken, type TokenVerifier } from "./auth";

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
