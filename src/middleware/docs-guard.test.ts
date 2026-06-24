import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import type { Env } from "../types/env";

const PROD_ENV: Env = {
  ENVIRONMENT: "production",
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

describe("docs-guard", () => {
  it("fuera de production la documentación está abierta", async () => {
    const res = await createApp().request(
      "/openapi.json",
      {},
      { ...PROD_ENV, ENVIRONMENT: "development" },
    );
    expect(res.status).toBe(200);
  });

  it("production sin DOCS_TOKEN: bloqueada (404)", async () => {
    const res = await createApp().request("/openapi.json", {}, PROD_ENV);
    expect(res.status).toBe(404);
  });

  it("production con DOCS_TOKEN y sin Authorization: 401", async () => {
    const res = await createApp().request("/openapi.json", {}, { ...PROD_ENV, DOCS_TOKEN: "sek" });
    expect(res.status).toBe(401);
  });

  it("production con DOCS_TOKEN y Bearer correcto: 200", async () => {
    const res = await createApp().request(
      "/openapi.json",
      { headers: { Authorization: "Bearer sek" } },
      { ...PROD_ENV, DOCS_TOKEN: "sek" },
    );
    expect(res.status).toBe(200);
  });
});
