import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreateAcademyPlanRoute,
  DeleteAcademyPlanRoute,
  ListAcademyPlansAdminRoute,
  ListAcademyPlansRoute,
  UpdateAcademyPlanRoute,
} from "./academy.routes";
import {
  createAcademyPlan,
  deleteAcademyPlan,
  listAcademyPlans,
  listAcademyPlansAdmin,
  updateAcademyPlan,
} from "./academy.service";

// El gate de autorización (`requireAdmin`) vive en el router; los handlers admin asumen que
// ya pasó. Cada uno arma el admin client (service-role, bypassa RLS) por request — sin estado
// en módulo (Workers, §3).

/** GET /academy/plans — lista los paquetes activos con textos localizados y matriz de features. */
export const listAcademyPlansHandler: RouteHandler<ListAcademyPlansRoute, AuthedBindings> = async (
  c,
) => {
  const { locale } = c.req.valid("query");
  const result = await listAcademyPlans(createSupabaseAdminClient(c.env), { locale });
  return c.json(result, 200);
};

/** GET /admin/academy/plans — lista TODOS los paquetes con traducciones e ids de features (admin). */
export const listAcademyPlansAdminHandler: RouteHandler<
  ListAcademyPlansAdminRoute,
  AuthedBindings
> = async (c) => {
  const result = await listAcademyPlansAdmin(createSupabaseAdminClient(c.env));
  return c.json(result, 200);
};

/** POST /admin/academy/plans — crea un paquete con precios, traducciones y features (admin). */
export const createAcademyPlanHandler: RouteHandler<
  CreateAcademyPlanRoute,
  AuthedBindings
> = async (c) => {
  const body = c.req.valid("json");
  const plan = await createAcademyPlan(createSupabaseAdminClient(c.env), {
    slug: body.slug,
    priceRegular: body.priceRegular,
    priceOffer: body.priceOffer ?? null,
    currency: body.currency,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
    translations: body.translations.map((t) => ({
      locale: t.locale,
      name: t.name,
      subtitle: t.subtitle ?? null,
    })),
    featureIds: body.featureIds,
  });
  return c.json({ plan }, 201);
};

/** PATCH /admin/academy/plans/:id — actualización parcial del paquete (admin). */
export const updateAcademyPlanHandler: RouteHandler<
  UpdateAcademyPlanRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const plan = await updateAcademyPlan(createSupabaseAdminClient(c.env), id, {
    priceRegular: body.priceRegular,
    priceOffer: body.priceOffer,
    currency: body.currency,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
    translations: body.translations?.map((t) => ({
      locale: t.locale,
      name: t.name,
      subtitle: t.subtitle ?? null,
    })),
    featureIds: body.featureIds,
  });
  return c.json({ plan }, 200);
};

/** DELETE /admin/academy/plans/:id — elimina un paquete; traducciones/features caen por cascade (admin). */
export const deleteAcademyPlanHandler: RouteHandler<
  DeleteAcademyPlanRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  await deleteAcademyPlan(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
