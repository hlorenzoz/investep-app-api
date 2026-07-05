import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

const GroupingEnum = z.enum(["daily", "weekly", "monthly", "yearly"]);
const AccountTypeEnum = z.enum(["equity", "options"]);

/** Query de la proyección. `planId` define `accountType` + tasa desde el catálogo. */
export const ProjectionQuerySchema = z.object({
  planId: z.coerce.number().int().positive().openapi({
    example: 1,
    description: "Id del plan; define accountType y la tasa desde el catálogo.",
  }),
  baseAmount: z.coerce
    .number()
    .positive()
    .openapi({ example: 15000, description: "Monto inicial de la cuenta de bróker." }),
  startDate: z.coerce.date().openapi({
    example: "2026-07-01",
    description: "Fecha inicial de la cuenta (ISO YYYY-MM-DD).",
  }),
  grouping: GroupingEnum.openapi({ example: "monthly" }),
  years: z.coerce.number().int().min(1).max(10).optional().openapi({
    description: "Override del horizonte (default: daily 1, weekly 1, monthly 3, yearly 5).",
  }),
});

export const ProjectionPeriodSchema = z
  .object({
    periodIndex: z.number().int().openapi({ example: 1 }),
    label: z.string().openapi({ example: "Ago 26" }),
    date: z.string().openapi({
      example: "2026-08-01",
      description: "Fecha real del primer día del bucket (ISO).",
    }),
    startBalance: z.number().openapi({ example: 18750 }),
    yieldAmount: z.number().openapi({ example: 4687.5 }),
    endBalance: z.number().openapi({ example: 23437.5 }),
  })
  .openapi("ProjectionPeriod");

export const ProjectionResponseSchema = z
  .object({
    planId: z.number().int().openapi({ example: 1 }),
    accountType: AccountTypeEnum.openapi({ example: "equity" }),
    grouping: GroupingEnum.openapi({ example: "monthly" }),
    periods: z.array(ProjectionPeriodSchema),
  })
  .openapi("ProjectionResponse");

export const getProjectionRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Projections"],
  summary: "Serie de proyección Desempeño vs Plan",
  description:
    "Proyección de interés compuesto de una cuenta de bróker según su plan. Modelo canónico: una " +
    "serie diaria única (día hábil) reagrupada por `grouping`; las 4 vistas convergen al mismo saldo " +
    "por horizonte. Equity: `r=(1+mensual)^(1/20)−1`. Options: `r=0.10·diario`. Resultado cacheado (KV).",
  security: [{ bearerAuth: [] }],
  request: { query: ProjectionQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ProjectionResponseSchema } },
      description: "Serie de proyección.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    404: jsonErrorResponse("No existe un plan con ese id (`NOT_FOUND`)."),
    422: jsonErrorResponse("Query inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});

export type GetProjectionRoute = typeof getProjectionRoute;
