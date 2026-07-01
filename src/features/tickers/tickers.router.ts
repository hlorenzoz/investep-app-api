import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  associatePlanHandler,
  associateRelationHandler,
  createTickerHandler,
  deleteTickerHandler,
  disassociatePlanHandler,
  disassociateRelationHandler,
  getTickerHandler,
  listTickersHandler,
  updateTickerHandler,
} from "./tickers.handlers";
import {
  associatePlanRoute,
  associateRelationRoute,
  createTickerRoute,
  deleteTickerRoute,
  disassociatePlanRoute,
  disassociateRelationRoute,
  getTickerRoute,
  listTickersRoute,
  updateTickerRoute,
} from "./tickers.routes";

/**
 * Dominio: TICKERS — catálogo y consulta de activos financieros.
 * Lectura para usuarios autenticados.
 */
export const tickersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

tickersRouter.use("*", requireAuth);
tickersRouter.openapi(listTickersRoute, listTickersHandler);
tickersRouter.openapi(getTickerRoute, getTickerHandler);

/**
 * Router ADMIN de tickers: mutaciones, relaciones y planes. Monta en `/admin/tickers`.
 * requireAuth + requireAdmin: solo administradores.
 */
export const adminTickersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

adminTickersRouter.use("*", requireAuth);
adminTickersRouter.use("*", requireAdmin);

adminTickersRouter
  .openapi(createTickerRoute, createTickerHandler)
  .openapi(updateTickerRoute, updateTickerHandler)
  .openapi(deleteTickerRoute, deleteTickerHandler)
  .openapi(associateRelationRoute, associateRelationHandler)
  .openapi(disassociateRelationRoute, disassociateRelationHandler)
  .openapi(associatePlanRoute, associatePlanHandler)
  .openapi(disassociatePlanRoute, disassociatePlanHandler);
