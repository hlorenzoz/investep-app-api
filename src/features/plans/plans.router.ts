import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import { listPlansHandler } from "./plans.handlers";
import { listPlansRoute } from "./plans.routes";

/**
 * Dominio: PLANS — catálogo de planes de inversión (target mensual por tipo de cuenta).
 * Lectura para usuarios autenticados.
 */
export const plansRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

plansRouter.use("*", requireAuth);
plansRouter.openapi(listPlansRoute, listPlansHandler);
