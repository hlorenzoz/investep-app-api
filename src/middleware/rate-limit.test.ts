import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppBindings } from "../types/app";
import type { Env, RateLimiter } from "../types/env";
import { errorHandler } from "./error-handler";
import { createRateLimitMiddleware } from "./rate-limit";

const BASE_ENV = { ENVIRONMENT: "development" } as Env;

/** Limiter fake que registra las keys recibidas y responde según `allow`. */
function fakeLimiter(allow: boolean): RateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success: allow };
    },
  };
}

function buildApp(limiter: RateLimiter | undefined, methods?: readonly string[]) {
  const app = new Hono<AppBindings>();
  app.onError(errorHandler);
  app.use(
    "/protected/*",
    createRateLimitMiddleware({
      name: "TEST_LIMITER",
      getLimiter: () => limiter,
      methods,
    }),
  );
  app.get("/protected/resource", (c) => c.json({ ok: true }));
  app.post("/protected/resource", (c) => c.json({ ok: true }));
  return app;
}

describe("Middleware de rate limiting", () => {
  it("deja pasar cuando el limiter aprueba y usa la IP como key", async () => {
    const limiter = fakeLimiter(true);
    const app = buildApp(limiter);

    const res = await app.request(
      "/protected/resource",
      { headers: { "CF-Connecting-IP": "203.0.113.7" } },
      BASE_ENV,
    );

    expect(res.status).toBe(200);
    expect(limiter.keys).toEqual(["203.0.113.7"]);
  });

  it("429 con código RATE_LIMITED cuando el límite se excede", async () => {
    const app = buildApp(fakeLimiter(false));

    const res = await app.request(
      "/protected/resource",
      { headers: { "CF-Connecting-IP": "203.0.113.7" } },
      BASE_ENV,
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("fail-open cuando el binding no está configurado", async () => {
    const app = buildApp(undefined);

    const res = await app.request("/protected/resource", {}, BASE_ENV);

    expect(res.status).toBe(200);
  });

  it("con filtro de métodos solo limita los métodos configurados", async () => {
    const limiter = fakeLimiter(false);
    const app = buildApp(limiter, ["POST"]);

    const resGet = await app.request("/protected/resource", {}, BASE_ENV);
    expect(resGet.status).toBe(200);

    const resPost = await app.request("/protected/resource", { method: "POST" }, BASE_ENV);
    expect(resPost.status).toBe(429);
    expect(limiter.keys.length).toBe(1);
  });

  it('usa "unknown" como key si falta CF-Connecting-IP', async () => {
    const limiter = fakeLimiter(true);
    const app = buildApp(limiter);

    await app.request("/protected/resource", {}, BASE_ENV);

    expect(limiter.keys).toEqual(["unknown"]);
  });
});
