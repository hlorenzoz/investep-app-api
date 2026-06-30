import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreateAcademyFeatureRoute,
  CreateAcademyPlanRoute,
  DeleteAcademyFeatureRoute,
  DeleteAcademyPlanRoute,
  ListAcademyFeaturesRoute,
  ListAcademyPlansAdminRoute,
  ListAcademyPlansRoute,
  UpdateAcademyFeatureRoute,
  UpdateAcademyPlanRoute,
} from "./academy.routes";
import {
  createAcademyFeature,
  createAcademyPlan,
  deleteAcademyFeature,
  deleteAcademyPlan,
  listAcademyFeaturesAdmin,
  listAcademyPlans,
  listAcademyPlansAdmin,
  updateAcademyFeature,
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

/**
 * GET /admin/academy/features
 *
 * Lista todas las características disponibles en la academia, ordenadas por su
 * prioridad visual (`sort_order`). Retorna todas las traducciones configuradas
 * para cada característica de modo que puedan ser administradas de forma centralizada.
 *
 * @param c Contexto de Hono
 * @returns 200 OK con la lista de características y sus traducciones
 */
export const listAcademyFeaturesHandler: RouteHandler<
  ListAcademyFeaturesRoute,
  AuthedBindings
> = async (c) => {
  const result = await listAcademyFeaturesAdmin(createSupabaseAdminClient(c.env));
  return c.json(result, 200);
};

/**
 * POST /admin/academy/features
 *
 * Crea una nueva característica en la academia. Si la inserción de las traducciones
 * correspondientes falla debido a locales inválidos o un outage temporal, realiza
 * un rollback best-effort del registro principal de la característica para mantener
 * consistencia en la base de datos de forma transaccional artificial.
 *
 * @param c Contexto de Hono que incluye el JSON del body con CreateAcademyFeatureSchema
 * @returns 201 Created con la característica creada y sus traducciones
 */
export const createAcademyFeatureHandler: RouteHandler<
  CreateAcademyFeatureRoute,
  AuthedBindings
> = async (c) => {
  const body = c.req.valid("json");
  const feature = await createAcademyFeature(createSupabaseAdminClient(c.env), {
    slug: body.slug,
    sortOrder: body.sortOrder,
    translations: body.translations.map((t) => ({
      locale: t.locale,
      label: t.label,
    })),
  });
  return c.json({ feature }, 201);
};

/**
 * PATCH /admin/academy/features/:id
 *
 * Actualización parcial de una característica (únicamente son modificables el orden
 * y/o las traducciones; el slug es inmutable). Sigue una semántica de reemplazo
 * completo de traducciones: se insertan/actualizan las presentes en el payload
 * y se eliminan de la base de datos todas las que no hayan sido provistas.
 *
 * @param c Contexto de Hono con el ID en la ruta y el JSON del body con UpdateAcademyFeatureSchema
 * @returns 200 OK con el estado final de la característica en memoria
 */
export const updateAcademyFeatureHandler: RouteHandler<
  UpdateAcademyFeatureRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const feature = await updateAcademyFeature(createSupabaseAdminClient(c.env), id, {
    sortOrder: body.sortOrder,
    translations: body.translations?.map((t) => ({
      locale: t.locale,
      label: t.label,
    })),
  });
  return c.json({ feature }, 200);
};

/**
 * DELETE /admin/academy/features/:id
 *
 * Elimina una característica de la academia. Todas las traducciones y asociaciones
 * con planes de membresía existentes se eliminan en cascada en la base de datos
 * gracias a la restricción `ON DELETE CASCADE`.
 *
 * @param c Contexto de Hono con el ID de la característica en la ruta
 * @returns 200 OK indicando eliminación exitosa
 */
export const deleteAcademyFeatureHandler: RouteHandler<
  DeleteAcademyFeatureRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  await deleteAcademyFeature(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
