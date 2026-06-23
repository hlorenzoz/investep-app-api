import type { RouteHandler } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";
import type { HealthRoute } from "./health.routes";

export const healthHandler: RouteHandler<HealthRoute, AppBindings> = (c) => {
  return c.json(
    {
      status: "ok",
      service: "investep-app-api",
      timestamp: new Date().toISOString(),
    },
    200,
  );
};
