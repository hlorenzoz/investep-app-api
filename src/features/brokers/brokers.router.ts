import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createBrokerHandler,
  deleteBrokerHandler,
  getBrokerHandler,
  listBrokersHandler,
  updateBrokerHandler,
} from "./brokers.handlers";
import {
  createBrokerRoute,
  deleteBrokerRoute,
  getBrokerRoute,
  listBrokersRoute,
  updateBrokerRoute,
} from "./brokers.routes";

/**
 * Router CLIENTE de brokers: lectura del catálogo para cualquier usuario autenticado.
 * Monta en `/brokers` (GET lista + GET por id/slug). Desbloquea el paso "Elegí tu broker".
 */
export const brokersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
brokersRouter.use("*", requireAuth);
brokersRouter.openapi(listBrokersRoute, listBrokersHandler);
brokersRouter.openapi(getBrokerRoute, getBrokerHandler);

/**
 * Router ADMIN de brokers: mutaciones del catálogo. Monta en `/admin/brokers`.
 * `requireAuth` + `requireAdmin`: un no-admin recibe 403 (el gate vive acá porque los
 * handlers usan el service-role client, que bypassa RLS).
 */
export const adminBrokersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
adminBrokersRouter.use("*", requireAuth);
adminBrokersRouter.use("*", requireAdmin);
adminBrokersRouter
  .openapi(createBrokerRoute, createBrokerHandler)
  .openapi(updateBrokerRoute, updateBrokerHandler)
  .openapi(deleteBrokerRoute, deleteBrokerHandler);
