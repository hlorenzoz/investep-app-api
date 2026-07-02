import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

const AccountTypeEnum = z.enum(["equity", "options"]);
const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .openapi({ example: "USD" });

export const CapitalSchema = z
  .object({
    totalCapital: z.number().nonnegative().openapi({ example: 5000 }),
    currency: CurrencySchema,
  })
  .openapi("Capital");

export const AllocationSchema = z
  .object({
    id: z.string().openapi({ example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b" }),
    brokerId: z.number().openapi({ example: 2 }),
    brokerSlug: z.string().openapi({ example: "interactive-brokers" }),
    accountType: AccountTypeEnum.openapi({ example: "equity" }),
    investmentPlanId: z.number().openapi({ example: 1 }),
    targetMonthlyPct: z.number().openapi({ example: 25 }),
    initialDeposit: z.number().openapi({ example: 4000 }),
    currency: CurrencySchema,
    createdAt: z.string().datetime().openapi({ example: "2026-06-25T05:00:00.000Z" }),
  })
  .openapi("Allocation");

export const CapitalViewSchema = z
  .object({
    capital: CapitalSchema.nullable(),
    allocations: z.array(AllocationSchema),
    totalAllocated: z.number().openapi({ example: 5000 }),
  })
  .openapi("CapitalView");

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

// --- GET /capital ---
export const getCapitalRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Capital"],
  summary: "Capital y asignaciones del usuario",
  description:
    "Devuelve el capital total (derivado: la suma de las cuentas de bróker) y sus asignaciones.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { content: { "application/json": { schema: CapitalViewSchema } }, description: "OK." },
    401: jsonErrorResponse("Falta o es inválido el token."),
  },
});
export type GetCapitalRoute = typeof getCapitalRoute;

// --- POST /capital/allocations ---
export const createAllocationRoute = createRoute({
  method: "post",
  path: "/allocations",
  tags: ["Capital"],
  summary: "Asignar capital a un broker",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brokerId: z.number().int().positive(),
            investmentPlanId: z.number().int().positive(),
            initialDeposit: z.number().nonnegative(),
            currency: CurrencySchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ allocation: AllocationSchema }) } },
      description: "Asignación creada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Broker o plan inexistente."),
    422: jsonErrorResponse("Entrada inválida (moneda o cuerpo malformado)."),
  },
});
export type CreateAllocationRoute = typeof createAllocationRoute;

// --- PATCH /capital/allocations/{id} ---
export const updateAllocationRoute = createRoute({
  method: "patch",
  path: "/allocations/{id}",
  tags: ["Capital"],
  summary: "Editar una asignación (depósito, plan, moneda)",
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            investmentPlanId: z.number().int().positive().optional(),
            initialDeposit: z.number().nonnegative().optional(),
            currency: CurrencySchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ allocation: AllocationSchema }) } },
      description: "Asignación actualizada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Asignación o plan inexistente."),
    409: jsonErrorResponse("No hay capital configurado para el usuario."),
    422: jsonErrorResponse("Entrada inválida."),
  },
});
export type UpdateAllocationRoute = typeof updateAllocationRoute;

// --- DELETE /capital/allocations/{id} ---
export const deleteAllocationRoute = createRoute({
  method: "delete",
  path: "/allocations/{id}",
  tags: ["Capital"],
  summary: "Eliminar una asignación",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ deleted: z.literal(true) }) },
      },
      description: "Asignación eliminada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Asignación no encontrada."),
  },
});
export type DeleteAllocationRoute = typeof deleteAllocationRoute;

// --- POST /capital/transfers ---
export const TransferCapitalRequestSchema = z
  .object({
    fromAllocationId: z.string().uuid().openapi({
      description: "ID (UUID) de la asignación de bróker de origen.",
      example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b",
    }),
    toAllocationId: z.string().uuid().openapi({
      description: "ID (UUID) de la asignación de bróker de destino.",
      example: "1c2d3e4f-5a6b-7c8d-9e0f-2a3b4c5d6e7f",
    }),
    amount: z.number().positive().openapi({
      description: "Monto a transferir.",
      example: 500,
    }),
  })
  .openapi("TransferCapitalRequest");

export const transferCapitalRoute = createRoute({
  method: "post",
  path: "/transfers",
  tags: ["Capital"],
  summary: "Transferir saldo entre dos cuentas de bróker",
  description:
    "Transfiere saldo de forma manual entre dos asignaciones de bróker del usuario para balancear las cuentas.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: TransferCapitalRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true) }),
        },
      },
      description: "Transferencia realizada con éxito.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Asignación de origen/destino inexistente o no pertenece al usuario."),
    409: jsonErrorResponse("Monto inválido, cuentas iguales, o saldo insuficiente en el origen."),
    422: jsonErrorResponse("Cuerpo de petición malformado (Zod)."),
  },
});
export type TransferCapitalRoute = typeof transferCapitalRoute;
