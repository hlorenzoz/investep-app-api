import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import type { Env } from "../types/env";
import { resolveAllowedOrigin } from "./cors";

const BASE_ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

describe("resolveAllowedOrigin", () => {
  it("dev: permite cualquier localhost (cualquier puerto)", () => {
    expect(resolveAllowedOrigin(BASE_ENV, "http://localhost:8080")).toBe("http://localhost:8080");
    expect(resolveAllowedOrigin(BASE_ENV, "http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("permite orígenes configurados en CORS_ORIGINS (coma-separado)", () => {
    const env = { ...BASE_ENV, CORS_ORIGINS: "https://app.investep.com, https://x.com" };
    expect(resolveAllowedOrigin(env, "https://app.investep.com")).toBe("https://app.investep.com");
    expect(resolveAllowedOrigin(env, "https://x.com")).toBe("https://x.com");
  });

  it("rechaza (null) un origen desconocido", () => {
    expect(resolveAllowedOrigin(BASE_ENV, "https://evil.com")).toBeNull();
  });

  it("producción: NO permite localhost por defecto (sin allowlist explícita)", () => {
    const env = { ...BASE_ENV, ENVIRONMENT: "production" as const };
    expect(resolveAllowedOrigin(env, "http://localhost:8080")).toBeNull();
  });

  it("producción: permite solo lo configurado", () => {
    const env = {
      ...BASE_ENV,
      ENVIRONMENT: "production" as const,
      CORS_ORIGINS: "https://app.investep.com",
    };
    expect(resolveAllowedOrigin(env, "https://app.investep.com")).toBe("https://app.investep.com");
    expect(resolveAllowedOrigin(env, "https://evil.com")).toBeNull();
  });

  it("normaliza barra final y mayúsculas al comparar CORS_ORIGINS (#1)", () => {
    const trailing = {
      ...BASE_ENV,
      ENVIRONMENT: "production" as const,
      CORS_ORIGINS: "https://app.investep.com/",
    };
    expect(resolveAllowedOrigin(trailing, "https://app.investep.com")).toBe(
      "https://app.investep.com",
    );
    const cased = {
      ...BASE_ENV,
      ENVIRONMENT: "production" as const,
      CORS_ORIGINS: "https://App.Investep.com",
    };
    expect(resolveAllowedOrigin(cased, "https://app.investep.com")).toBe(
      "https://app.investep.com",
    );
  });

  it("staging permite localhost", () => {
    const env = { ...BASE_ENV, ENVIRONMENT: "staging" as const };
    expect(resolveAllowedOrigin(env, "http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("fail-closed: ENVIRONMENT ausente o mal escrito NO permite localhost (#2)", () => {
    const missing = { ...BASE_ENV, ENVIRONMENT: undefined as never };
    expect(resolveAllowedOrigin(missing, "http://localhost:8080")).toBeNull();
    const typo = { ...BASE_ENV, ENVIRONMENT: "prod" as never };
    expect(resolveAllowedOrigin(typo, "http://localhost:8080")).toBeNull();
  });

  it("tolera env undefined sin crashear → null (#3)", () => {
    expect(resolveAllowedOrigin(undefined, "http://localhost:8080")).toBeNull();
  });
});

describe("resolveAllowedOrigin · previews de Cloudflare Pages (investep-app)", () => {
  const staging = { ...BASE_ENV, ENVIRONMENT: "staging" as const };

  it("staging: permite un preview por-deploy (<hash>.investep-app.pages.dev)", () => {
    const origin = "https://24ba98ca.investep-app.pages.dev";
    expect(resolveAllowedOrigin(staging, origin)).toBe(origin);
  });

  it("staging: permite la URL canónica y el alias de branch de Pages", () => {
    expect(resolveAllowedOrigin(staging, "https://investep-app.pages.dev")).toBe(
      "https://investep-app.pages.dev",
    );
    expect(resolveAllowedOrigin(staging, "https://main.investep-app.pages.dev")).toBe(
      "https://main.investep-app.pages.dev",
    );
  });

  it("development: también permite los previews", () => {
    const origin = "https://abc123.investep-app.pages.dev";
    expect(resolveAllowedOrigin(BASE_ENV, origin)).toBe(origin);
  });

  it("producción: NO permite previews de Pages (debe usar custom domain en CORS_ORIGINS)", () => {
    const prod = { ...BASE_ENV, ENVIRONMENT: "production" as const };
    expect(resolveAllowedOrigin(prod, "https://24ba98ca.investep-app.pages.dev")).toBeNull();
  });

  it("staging: NO permite otro proyecto de Pages ni http (ancla al proyecto + https)", () => {
    expect(resolveAllowedOrigin(staging, "https://evil.pages.dev")).toBeNull();
    expect(resolveAllowedOrigin(staging, "https://otro-proyecto.pages.dev")).toBeNull();
    // suffix attack: el dominio real no es sufijo de otro
    expect(resolveAllowedOrigin(staging, "https://investep-app.pages.dev.evil.com")).toBeNull();
    // Pages sirve por https; http no
    expect(resolveAllowedOrigin(staging, "http://24ba98ca.investep-app.pages.dev")).toBeNull();
  });
});

describe("CORS middleware (integración)", () => {
  it("GET con Origin permitido → refleja Access-Control-Allow-Origin", async () => {
    const res = await createApp().request(
      "/health",
      { headers: { Origin: "http://localhost:8080" } },
      BASE_ENV,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  });

  it("preflight OPTIONS de una ruta protegida → 204 con métodos/headers (sin exigir auth)", async () => {
    const res = await createApp().request(
      "/tickers/relations-overview",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:8080",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      },
      BASE_ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("HEAD");
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain(
      "authorization",
    );
  });

  it("Origin no permitido → sin Access-Control-Allow-Origin", async () => {
    const res = await createApp().request(
      "/health",
      { headers: { Origin: "https://evil.com" } },
      BASE_ENV,
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("una respuesta de error (401 sin token) también refleja el header CORS", async () => {
    // Si el 401 no llevara ACAO, el navegador no podría leer el error y la app vería
    // un fallo de red genérico. Debe llevarlo.
    const res = await createApp().request(
      "/tickers/relations-overview",
      { headers: { Origin: "http://localhost:8080" } },
      BASE_ENV,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  });
});
