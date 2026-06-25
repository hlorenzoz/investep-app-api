import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

const AccountTypeEnum = z.enum(["equity", "options"]);

export const ListPlansQuerySchema = z.object({
  locale: z.string().min(2).max(10).optional().openapi({ example: "es" }),
  accountType: AccountTypeEnum.optional().openapi({ example: "equity" }),
});

export const PlanSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    accountType: AccountTypeEnum.openapi({ example: "equity" }),
    targetMonthlyPct: z.number().openapi({ example: 25 }),
    label: z.string().nullable().openapi({ example: "Activos 25% mensual" }),
  })
  .openapi("Plan");

export const PlansResponseSchema = z
  .object({
    locale: z.string().openapi({ example: "es" }),
    plans: z.array(PlanSchema),
  })
  .openapi("PlansResponse");

export const listPlansRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Plans"],
  summary: "Listar planes de inversión",
  description:
    "Catálogo de planes de profit (target mensual por tipo de cuenta) con la label localizada. " +
    "Filtrable por `accountType`; `locale` por defecto `es`.",
  security: [{ bearerAuth: [] }],
  request: { query: ListPlansQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: PlansResponseSchema } },
      description: "Planes disponibles.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
  },
});

export type ListPlansRoute = typeof listPlansRoute;
