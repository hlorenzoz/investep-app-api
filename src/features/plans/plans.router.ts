import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createPlanHandler,
  deletePlanHandler,
  listPlansHandler,
  updatePlanHandler,
} from "./plans.handlers";
import { createPlanRoute, deletePlanRoute, listPlansRoute, updatePlanRoute } from "./plans.routes";

/**
 * Dominio: PLANS — catálogo de planes de inversión (target mensual por tipo de cuenta).
 * Lectura para usuarios autenticados.
 */
export const plansRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

plansRouter.use("*", requireAuth);
plansRouter.openapi(listPlansRoute, listPlansHandler);

/**
 * Router ADMIN de plans: mutaciones del catálogo. Monta en `/admin/plans`.
 * `requireAuth` + `requireAdmin`: un no-admin recibe 403 (el gate vive acá porque los
 * handlers usan el service-role client, que bypassa RLS).
 */
export const adminPlansRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
adminPlansRouter.use("*", requireAuth);
adminPlansRouter.use("*", requireAdmin);
adminPlansRouter
  .openapi(createPlanRoute, createPlanHandler)
  .openapi(updatePlanRoute, updatePlanHandler)
  .openapi(deletePlanRoute, deletePlanHandler);
