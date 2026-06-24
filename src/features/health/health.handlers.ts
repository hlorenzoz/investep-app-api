import type { RouteHandler } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";
import type { HealthRoute, ReadinessRoute } from "./health.routes";

export const healthHandler: RouteHandler<HealthRoute, AppBindings> = (c) => {
  return c.json(
    {
      status: "ok",
      service: "investep-app-api",
      timestamp: new Date().toISOString(),
    },
    200,
  );
};

/**
 * Readiness: confirma que el Worker puede hablar con Supabase. Le pega al endpoint
 * REST raíz (PostgREST) con la apikey; no depende de ninguna tabla de negocio.
 * Es un check de infraestructura, por eso fetch directo y no el cliente de dominio.
 */
export const readinessHandler: RouteHandler<ReadinessRoute, AppBindings> = async (c) => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = c.env;

  let supabase: "up" | "down" = "down";
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    supabase = res.ok ? "up" : "down";
  } catch {
    supabase = "down";
  }

  if (supabase === "up") {
    return c.json({ status: "ready" as const, checks: { supabase } }, 200);
  }
  return c.json({ status: "degraded" as const, checks: { supabase } }, 503);
};
