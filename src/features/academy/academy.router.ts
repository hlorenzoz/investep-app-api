import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createAcademyPlanHandler,
  deleteAcademyPlanHandler,
  listAcademyPlansAdminHandler,
  listAcademyPlansHandler,
  updateAcademyPlanHandler,
} from "./academy.handlers";
import {
  createAcademyPlanRoute,
  deleteAcademyPlanRoute,
  listAcademyPlansAdminRoute,
  listAcademyPlansRoute,
  updateAcademyPlanRoute,
} from "./academy.routes";

/**
 * Dominio: ACADEMY — catálogo de paquetes de membresía (tiers) de la Academia.
 * Router CLIENTE: lectura de paquetes activos para usuarios autenticados. Monta en `/academy/plans`.
 */
export const academyRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
academyRouter.use("*", requireAuth);
academyRouter.openapi(listAcademyPlansRoute, listAcademyPlansHandler);

/**
 * Router ADMIN de academy: CRUD del catálogo. Monta en `/admin/academy/plans`.
 * `requireAuth` + `requireAdmin`: un no-admin recibe 403 (el gate vive acá porque los
 * handlers usan el service-role client, que bypassa RLS).
 */
export const adminAcademyRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
adminAcademyRouter.use("*", requireAuth);
adminAcademyRouter.use("*", requireAdmin);
adminAcademyRouter
  .openapi(listAcademyPlansAdminRoute, listAcademyPlansAdminHandler)
  .openapi(createAcademyPlanRoute, createAcademyPlanHandler)
  .openapi(updateAcademyPlanRoute, updateAcademyPlanHandler)
  .openapi(deleteAcademyPlanRoute, deleteAcademyPlanHandler);
