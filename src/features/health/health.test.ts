import { afterEach, describe, expect, it, mock } from "bun:test";
import { createApp } from "../../app";
import type { Env } from "../../types/env";

const READY_ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

describe("health", () => {
  it("GET /health responde 200 con status ok", async () => {
    const res = await createApp().request("/health");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("investep-app-api");
  });
});

describe("readiness", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /health/ready responde 200 con supabase up cuando responde", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await createApp().request("/health/ready", {}, READY_ENV);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { supabase: string } };
    expect(body.status).toBe("ready");
    expect(body.checks.supabase).toBe("up");
  });

  it("GET /health/ready responde 503 cuando Supabase no responde", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const res = await createApp().request("/health/ready", {}, READY_ENV);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { supabase: string } };
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("down");
  });
});
