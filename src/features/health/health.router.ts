import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";
import { healthHandler, readinessHandler } from "./health.handlers";
import { healthRoute, readinessRoute } from "./health.routes";

export const healthRouter = new OpenAPIHono<AppBindings>()
  .openapi(healthRoute, healthHandler)
  .openapi(readinessRoute, readinessHandler);
