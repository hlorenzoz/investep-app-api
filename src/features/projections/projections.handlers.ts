import type { RouteHandler } from "@hono/zod-openapi";
import { AppError } from "../../lib/errors";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import { projectionCacheKey, readProjectionCache, writeProjectionCache } from "./projections.cache";
import { getPlanRate } from "./projections.repository";
import type { GetProjectionRoute } from "./projections.routes";
import { buildProjection } from "./projections.service";

/**
 * GET /projections — serie "Desempeño vs Plan". Resuelve la tasa desde el catálogo por
 * `planId`, calcula la serie canónica (service puro) y la cachea en KV. La respuesta es
 * determinística por los inputs; un segundo request idéntico se sirve del cache.
 */
export const getProjectionHandler: RouteHandler<GetProjectionRoute, AuthedBindings> = async (c) => {
  const { planId, baseAmount, startDate, grouping, years } = c.req.valid("query");

  // Resolver el plan SIEMPRE (antes del cache): su tasa es mutable y entra en la clave, así
  // una edición del plan no puede servir una serie vieja.
  const admin = createSupabaseAdminClient(c.env);
  const plan = await getPlanRate(admin, planId);
  if (!plan) {
    throw new AppError("NOT_FOUND", "No existe un plan con ese id.", 404);
  }

  const cacheKey = projectionCacheKey({
    accountType: plan.accountType,
    ratePct: plan.ratePct,
    baseAmount,
    startDate,
    grouping,
    years,
  });

  // El cache guarda SOLO la serie (lo costoso de recomputar); planId/accountType/grouping
  // se reflejan del request actual, así dos planes con la misma tasa comparten serie sin
  // devolver un planId ajeno.
  const cached = await readProjectionCache(c.env.CACHE, cacheKey);
  if (cached) {
    c.header("X-Cache", "HIT");
    return c.json(
      { planId, accountType: plan.accountType, grouping, periods: JSON.parse(cached) } as never,
      200,
    );
  }

  const periods = buildProjection({
    baseAmount,
    startDate,
    grouping,
    accountType: plan.accountType,
    ratePct: plan.ratePct,
    years,
  });

  // Escritura best-effort fuera del camino de respuesta (Workers: waitUntil). En tests/entornos
  // sin ExecutionContext, `c.executionCtx` lanza → se awaitea el fallback.
  const write = writeProjectionCache(c.env.CACHE, cacheKey, JSON.stringify(periods));
  try {
    c.executionCtx.waitUntil(write);
  } catch {
    await write;
  }

  c.header("X-Cache", "MISS");
  return c.json({ planId, accountType: plan.accountType, grouping, periods }, 200);
};
