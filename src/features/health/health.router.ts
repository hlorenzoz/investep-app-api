import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";
import { healthHandler } from "./health.handlers";
import { healthRoute } from "./health.routes";

export const healthRouter = new OpenAPIHono<AppBindings>().openapi(healthRoute, healthHandler);
