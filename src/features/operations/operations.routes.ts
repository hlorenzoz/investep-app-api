import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";
import { tickerSymbolSchema } from "../../schemas/common";

const AccountTypeEnum = z.enum(["equity", "options"]);
const ContractTypeEnum = z.enum(["call", "put"]);
const OperationStatusEnum = z.enum(["open", "closed"]);

// numeric(14,4): 10 dígitos enteros + 4 decimales. Acotar en Zod para que un valor fuera
// de rango salga 422 (y no reviente en la DB con overflow → 500). MIN_POSITIVE es el menor
// valor > 0 representable a escala 4: por debajo redondearía a 0 y violaría los CHECK > 0.
const MAX_NUMERIC = 9_999_999_999.9999;
const MIN_POSITIVE = 0.0001;
const positiveAmount = () => z.number().min(MIN_POSITIVE).max(MAX_NUMERIC);
const nonNegativeAmount = () => z.number().min(0).max(MAX_NUMERIC);

// `timestamptz` acepta cualquier offset horario; permitir offset además de 'Z' (Zod usa
// offset:false por defecto) para no rechazar timestamps ISO-8601 legítimos con -04:00, etc.
const timestamp = () => z.string().datetime({ offset: true });

// Fechas de ENTRADA (openedAt/soldAt): el date-picker del form manda fecha sola
// (YYYY-MM-DD). Aceptamos eso además del datetime ISO completo, normalizando la fecha
// sola a medianoche UTC para que la DB reciba siempre un timestamp determinista (no
// dependiente de la zona horaria de la sesión). Las fechas de SALIDA siguen usando
// `timestamp()` (la DB devuelve siempre un timestamptz completo).
const dateOrTimestamp = () =>
  z.union([
    z.string().datetime({ offset: true }),
    z
      .string()
      .date()
      .transform((d) => `${d}T00:00:00.000Z`),
  ]);

const TickerSchema = tickerSymbolSchema.openapi({
  description: "Símbolo del ticker (se normaliza a mayúsculas; admite índices como ^GSPC).",
  example: "^GSPC",
});

/**
 * Operación del journal de trading. Los campos `strike`, `expirationDate` y
 * `contractType` aplican SOLO a opciones (null en activos). Los campos
 * `status`, `totalInvested`, `totalSale`, `gainAmount` y `gainPct` son
 * DERIVADOS por la API (no se envían al crear/editar): en opciones cada
 * contrato multiplica ×100.
 */
export const OperationSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "1c2d3e4f-5a6b-7c8d-9e0f-2a3b4c5d6e7f" }),
    allocationId: z.string().uuid().openapi({
      description: "Cuenta de bróker (broker allocation) a la que pertenece el registro.",
      example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b",
    }),
    accountType: AccountTypeEnum.openapi({
      description: "Tipo de operación. Deriva del tipo de la cuenta: equity (activos) u options.",
      example: "options",
    }),
    ticker: TickerSchema,
    openedAt: timestamp().openapi({
      description: "Fecha y hora de la compra (ISO 8601).",
      example: "2026-06-01T14:30:00.000Z",
    }),
    quantity: z.number().openapi({
      description: "Cantidad: acciones (fraccional permitida) o contratos (entera en opciones).",
      example: 2,
    }),
    buyPrice: z.number().openapi({
      description: "Precio de compra unitario (prima por acción en opciones).",
      example: 3.5,
    }),
    limitPrice: z.number().nullable().openapi({
      description: "Precio límite / objetivo de venta. Null si no se definió.",
      example: 5.5,
    }),
    strike: z.number().nullable().openapi({
      description: "SOLO opciones: precio de ejercicio. Null en activos.",
      example: 5300,
    }),
    expirationDate: z.string().nullable().openapi({
      description: "SOLO opciones: fecha de expiración del contrato (YYYY-MM-DD). Null en activos.",
      example: "2026-07-17",
    }),
    contractType: ContractTypeEnum.nullable().openapi({
      description: "SOLO opciones: call o put. Null en activos.",
      example: "call",
    }),
    soldAt: timestamp().nullable().openapi({
      description: "Fecha de venta. Null mientras la operación siga abierta.",
      example: "2026-06-15T18:00:00.000Z",
    }),
    sellPrice: z.number().nullable().openapi({
      description: "Precio de venta unitario. Null mientras la operación siga abierta.",
      example: 5,
    }),
    strategy: z.string().nullable().openapi({
      description: "Estrategia aplicada (texto libre).",
      example: "Iron Condor",
    }),
    notes: z.string().nullable().openapi({ description: "Notas libres del usuario." }),
    url: z.string().nullable().openapi({
      description: "URL de referencia (p. ej. cadena de opciones de Yahoo Finance).",
      example: "https://finance.yahoo.com/quote/%5EGSPC/options/",
    }),
    createdAt: timestamp().openapi({ example: "2026-06-01T14:30:00.000Z" }),
    updatedAt: timestamp().openapi({ example: "2026-06-01T14:30:00.000Z" }),
    status: OperationStatusEnum.openapi({
      description: "DERIVADO: open si no hay venta registrada; closed si la hay.",
      example: "open",
    }),
    totalInvested: z.number().openapi({
      description: "DERIVADO: cantidad × precio de compra (×100 por contrato en opciones).",
      example: 700,
    }),
    totalSale: z.number().nullable().openapi({
      description: "DERIVADO: cantidad × precio de venta (×100 en opciones). Null si está abierta.",
      example: 1000,
    }),
    gainAmount: z.number().nullable().openapi({
      description:
        "DERIVADO: ganancia en dinero (totalSale − totalInvested). Null si está abierta.",
      example: 300,
    }),
    gainPct: z.number().nullable().openapi({
      description: "DERIVADO: ganancia porcentual sobre el precio de compra. Null si está abierta.",
      example: 42.86,
    }),
  })
  .openapi("Operation");

export const CreateOperationRequestSchema = z
  .object({
    allocationId: z
      .string()
      .uuid()
      .openapi({
        description:
          "Cuenta de bróker destino. El tipo de la operación (equity/options) deriva del " +
          "account_type de esta cuenta: NO se envía en el body.",
        example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b",
      }),
    ticker: TickerSchema,
    openedAt: dateOrTimestamp().openapi({
      description: "Fecha de compra: acepta fecha sola (YYYY-MM-DD) o datetime ISO 8601 completo.",
      example: "2026-06-01T14:30:00.000Z",
    }),
    quantity: positiveAmount().openapi({
      description:
        "Cantidad. Acciones: fraccional permitida. Opciones: contratos, debe ser entera.",
      example: 2,
    }),
    buyPrice: positiveAmount().openapi({
      description: "Precio de compra unitario (prima por acción en opciones).",
      example: 3.5,
    }),
    limitPrice: positiveAmount().optional().openapi({
      description: "Precio límite / objetivo de venta.",
      example: 5.5,
    }),
    strike: positiveAmount().optional().openapi({
      description:
        "Precio de ejercicio. REQUERIDO si la cuenta es de opciones; prohibido en equity.",
      example: 5300,
    }),
    expirationDate: z.string().date().optional().openapi({
      description:
        "Fecha de expiración (YYYY-MM-DD). REQUERIDA si la cuenta es de opciones; prohibida en equity.",
      example: "2026-07-17",
    }),
    contractType: ContractTypeEnum.optional().openapi({
      description: "call o put. REQUERIDO si la cuenta es de opciones; prohibido en equity.",
      example: "call",
    }),
    soldAt: dateOrTimestamp().optional().openapi({
      description:
        "Fecha de venta (si se registra una operación ya cerrada). Acepta fecha sola o datetime ISO. Va junto a sellPrice y debe ser >= openedAt.",
      example: "2026-06-15T18:00:00.000Z",
    }),
    sellPrice: nonNegativeAmount().optional().openapi({
      description:
        "Precio de venta unitario (0 admitido: opción que expira sin valor). Va junto a soldAt.",
      example: 5,
    }),
    strategy: z.string().max(120).optional().openapi({ example: "Iron Condor" }),
    notes: z.string().max(2000).optional(),
    url: z.string().url().max(500).optional().openapi({
      example: "https://finance.yahoo.com/quote/%5EGSPC/options/",
    }),
  })
  .openapi("CreateOperationRequest");

export const UpdateOperationRequestSchema = z
  .object({
    ticker: TickerSchema.optional(),
    openedAt: dateOrTimestamp().optional(),
    quantity: positiveAmount().optional().openapi({
      description: "En opciones debe seguir siendo entera.",
    }),
    buyPrice: positiveAmount().optional(),
    limitPrice: positiveAmount().nullable().optional().openapi({
      description: "null explícito limpia el precio límite.",
    }),
    strike: positiveAmount().optional().openapi({
      description: "SOLO operaciones de opciones (no admite null: es obligatorio en opciones).",
    }),
    expirationDate: z.string().date().optional().openapi({
      description: "SOLO operaciones de opciones.",
    }),
    contractType: ContractTypeEnum.optional().openapi({
      description: "SOLO operaciones de opciones.",
    }),
    soldAt: dateOrTimestamp().nullable().optional().openapi({
      description:
        "Registrar venta (fecha sola o datetime ISO, junto a sellPrice, >= openedAt) o null para deshacerla (junto a sellPrice: null).",
    }),
    sellPrice: nonNegativeAmount().nullable().optional().openapi({
      description: "Va junto a soldAt (ambos con valor o ambos null).",
    }),
    strategy: z.string().max(120).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    url: z.string().url().max(500).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "El cuerpo del PATCH no puede estar vacío: indicá al menos un campo a modificar.",
  })
  .openapi("UpdateOperationRequest");

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const ListQuerySchema = z.object({
  allocationId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "allocationId", in: "query" },
      description: "Filtra por cuenta de bróker (la pestaña Registros de esa cuenta).",
    }),
  status: OperationStatusEnum.optional().openapi({
    param: { name: "status", in: "query" },
    description: "Filtra por estado: open (sin venta) o closed (vendidas).",
  }),
});

// --- GET /operations ---
export const listOperationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Operations"],
  summary: "Listar operaciones del usuario",
  description:
    "Devuelve las operaciones del journal (más reciente primero), con los campos derivados " +
    "calculados. Filtros opcionales por cuenta de bróker y estado open/closed.",
  security: [{ bearerAuth: [] }],
  request: { query: ListQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ operations: z.array(OperationSchema) }) },
      },
      description: "OK.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    422: jsonErrorResponse("Parámetros de consulta inválidos."),
  },
});
export type ListOperationsRoute = typeof listOperationsRoute;

// --- POST /operations ---
export const createOperationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Operations"],
  summary: "Registrar una operación",
  description:
    "Crea un registro en la pestaña Registros de la cuenta indicada. El tipo (equity/options) " +
    "deriva del account_type de la cuenta. Si la cuenta es de opciones, strike, expirationDate y " +
    "contractType son obligatorios y la cantidad debe ser entera; en equity esos campos se rechazan.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateOperationRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ operation: OperationSchema }) } },
      description: "Operación registrada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("La cuenta de bróker indicada no existe o no es del usuario."),
    422: jsonErrorResponse(
      "Entrada inválida: campos incoherentes con el tipo de cuenta, venta incompleta o body malformado.",
    ),
  },
});
export type CreateOperationRoute = typeof createOperationRoute;

// --- GET /operations/{id} ---
export const getOperationRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Operations"],
  summary: "Detalle de una operación",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ operation: OperationSchema }) } },
      description: "OK.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Operación inexistente o no pertenece al usuario."),
    422: jsonErrorResponse("Id malformado (no UUID)."),
  },
});
export type GetOperationRoute = typeof getOperationRoute;

// --- PATCH /operations/{id} ---
export const updateOperationRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Operations"],
  summary: "Editar una operación (incluye registrar o deshacer la venta)",
  description:
    "Actualización parcial. `null` explícito limpia los campos anulables. La venta se registra " +
    "con soldAt + sellPrice juntos, y se deshace enviando ambos en null.",
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: UpdateOperationRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ operation: OperationSchema }) } },
      description: "Operación actualizada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Operación inexistente o no pertenece al usuario."),
    422: jsonErrorResponse(
      "Entrada inválida: campos incoherentes con el tipo de operación o venta incompleta.",
    ),
  },
});
export type UpdateOperationRoute = typeof updateOperationRoute;

// --- DELETE /operations/{id} ---
export const deleteOperationRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Operations"],
  summary: "Eliminar una operación",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Operación eliminada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
    404: jsonErrorResponse("Operación inexistente o no pertenece al usuario."),
    422: jsonErrorResponse("Id malformado (no UUID)."),
  },
});
export type DeleteOperationRoute = typeof deleteOperationRoute;
