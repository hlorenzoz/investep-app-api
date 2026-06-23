import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/types/env";

const DEV_ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

describe("app", () => {
  it("monta y responde /health", async () => {
    const res = await createApp().request("/health", {}, DEV_ENV);
    expect(res.status).toBe(200);
  });

  it("expone /openapi.json en development", async () => {
    const res = await createApp().request("/openapi.json", {}, DEV_ENV);
    expect(res.status).toBe(200);

    const doc = (await res.json()) as { openapi: string; info: { title: string } };
    expect(doc.openapi).toBeDefined();
    expect(doc.info.title).toBe("Investep App API");
  });

  it("bloquea la documentación en production sin DOCS_TOKEN", async () => {
    const res = await createApp().request(
      "/openapi.json",
      {},
      { ...DEV_ENV, ENVIRONMENT: "production" },
    );
    expect(res.status).toBe(404);
  });
});
