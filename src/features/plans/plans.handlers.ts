import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreatePlanRoute,
  DeletePlanRoute,
  ListPlansRoute,
  UpdatePlanRoute,
} from "./plans.routes";
import { createPlan, deletePlan, listPlans, updatePlan } from "./plans.service";

// El gate de autorización (`requireAdmin`) vive en el router; estos handlers asumen
// que ya pasó. Cada uno arma el admin client (service-role, bypassa RLS) por request
// — sin estado en módulo (Workers, §3).

/** GET /plans — lista el catálogo de planes; soporta filtros `locale` y `accountType` por query. */
export const listPlansHandler: RouteHandler<ListPlansRoute, AuthedBindings> = async (c) => {
  const { locale, accountType } = c.req.valid("query");
  const admin = createSupabaseAdminClient(c.env);
  const result = await listPlans(admin, { locale, accountType });
  return c.json(result, 200);
};

/** POST /plans — crea un plan con sus traducciones (admin-only). Responde 201 con el plan creado. */
export const createPlanHandler: RouteHandler<CreatePlanRoute, AuthedBindings> = async (c) => {
  const input = c.req.valid("json");
  const plan = await createPlan(createSupabaseAdminClient(c.env), input);
  return c.json({ plan }, 201);
};

/** PATCH /plans/:id — actualiza target mensual y/o traducciones de un plan (admin-only). */
export const updatePlanHandler: RouteHandler<UpdatePlanRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const plan = await updatePlan(createSupabaseAdminClient(c.env), id, patch);
  return c.json({ plan }, 200);
};

/** DELETE /plans/:id — elimina un plan (admin-only). Sus traducciones caen por cascade. */
export const deletePlanHandler: RouteHandler<DeletePlanRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  await deletePlan(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
