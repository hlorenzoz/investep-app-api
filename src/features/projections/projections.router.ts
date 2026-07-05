import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import { getProjectionHandler } from "./projections.handlers";
import { getProjectionRoute } from "./projections.routes";

/**
 * Dominio: PROJECTIONS — serie "Desempeño vs Plan" calculada server-side.
 * Lectura para usuarios autenticados; el cálculo es puro y el resultado se cachea en KV.
 */
export const projectionsRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

projectionsRouter.use("*", requireAuth);
projectionsRouter.openapi(getProjectionRoute, getProjectionHandler);
