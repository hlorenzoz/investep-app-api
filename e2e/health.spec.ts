import { expect, test } from "@playwright/test";

/**
 * E2E de los health checks contra la API levantada de verdad + Supabase real.
 * Es el flujo end-to-end más completo disponible hoy; crecerá con los endpoints de negocio.
 */
test.describe("health (E2E)", () => {
  test("GET /health → 200 (liveness)", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("investep-app-api");
  });

  test("GET /health/ready → 200 con Supabase accesible", async ({ request }) => {
    const res = await request.get("/health/ready");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; checks: { supabase: string } };
    expect(body.status).toBe("ready");
    expect(body.checks.supabase).toBe("up");
  });
});
