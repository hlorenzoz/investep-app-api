import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createOperationHandler,
  deleteOperationHandler,
  getOperationHandler,
  listOperationsHandler,
  updateOperationHandler,
} from "./operations.handlers";
import {
  createOperationRoute,
  deleteOperationRoute,
  getOperationRoute,
  listOperationsRoute,
  updateOperationRoute,
} from "./operations.routes";

/**
 * Dominio: OPERATIONS — journal de operaciones (órdenes puestas en el mercado)
 * de la pestaña Registros de cada cuenta de bróker. Activos y opciones.
 * Todas las rutas requieren auth; la pertenencia se filtra por user_id en el service.
 */
export const operationsRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

operationsRouter.use("*", requireAuth);

operationsRouter
  .openapi(listOperationsRoute, listOperationsHandler)
  .openapi(createOperationRoute, createOperationHandler)
  .openapi(getOperationRoute, getOperationHandler)
  .openapi(updateOperationRoute, updateOperationHandler)
  .openapi(deleteOperationRoute, deleteOperationHandler);
