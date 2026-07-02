import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createAllocationHandler,
  deleteAllocationHandler,
  getCapitalHandler,
  transferCapitalHandler,
  updateAllocationHandler,
} from "./capital.handlers";
import {
  createAllocationRoute,
  deleteAllocationRoute,
  getCapitalRoute,
  transferCapitalRoute,
  updateAllocationRoute,
} from "./capital.routes";

/**
 * Dominio: CAPITAL — capital del usuario y su asignación a brokers (planificación).
 * Todas las rutas requieren auth; la pertenencia se filtra por user_id en el service.
 */
export const capitalRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

capitalRouter.use("*", requireAuth);

capitalRouter
  .openapi(getCapitalRoute, getCapitalHandler)
  .openapi(createAllocationRoute, createAllocationHandler)
  .openapi(updateAllocationRoute, updateAllocationHandler)
  .openapi(deleteAllocationRoute, deleteAllocationHandler)
  .openapi(transferCapitalRoute, transferCapitalHandler);
