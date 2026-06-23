import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

export const HealthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.string().openapi({ example: "investep-app-api" }),
    timestamp: z.string().openapi({ example: "2026-06-23T12:00:00.000Z" }),
  })
  .openapi("Health");

export const healthRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Health check",
  description: "Indica si el servicio está operativo.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HealthSchema,
        },
      },
      description: "El servicio está operativo.",
    },
    500: jsonErrorResponse("Error interno."),
  },
});

export type HealthRoute = typeof healthRoute;
