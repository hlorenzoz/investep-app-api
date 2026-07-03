import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  addFavoriteHandler,
  associatePlanHandler,
  associateRelationHandler,
  createTickerHandler,
  deleteTickerHandler,
  disassociatePlanHandler,
  disassociateRelationHandler,
  getTickerHandler,
  listTickersHandler,
  relationsOverviewHandler,
  removeFavoriteHandler,
  updateTickerHandler,
} from "./tickers.handlers";
import {
  addFavoriteRoute,
  associatePlanRoute,
  associateRelationRoute,
  createTickerRoute,
  deleteTickerRoute,
  disassociatePlanRoute,
  disassociateRelationRoute,
  getTickerRoute,
  listTickersRoute,
  relationsOverviewRoute,
  removeFavoriteRoute,
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
// Ruta estática ANTES de la paramétrica `/{symbol}` para que no la capture como símbolo.
tickersRouter.openapi(relationsOverviewRoute, relationsOverviewHandler);
// Favoritos: `/{symbol}/favorite` es más específica que `/{symbol}`, se registra antes.
tickersRouter.openapi(addFavoriteRoute, addFavoriteHandler);
tickersRouter.openapi(removeFavoriteRoute, removeFavoriteHandler);
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
