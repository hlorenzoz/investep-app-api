import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

export const AssetClassEnum = z.enum(["stock", "etf", "index", "crypto", "commodity", "currency"]);
export const RelationTypeEnum = z.enum(["x2", "x3", "inverso"]);

export const TickerSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    symbol: z.string().openapi({ example: "TSLA" }),
    name: z.string().openapi({ example: "Tesla, Inc." }),
    assetClass: AssetClassEnum.openapi({ example: "stock" }),
    exchange: z.string().nullable().openapi({ example: "NASDAQ" }),
    sector: z.string().nullable().openapi({ example: "Consumer Cyclical" }),
    industry: z.string().nullable().openapi({ example: "Auto Manufacturers" }),
    country: z.string().nullable().openapi({ example: "USA" }),
    price: z.number().nullable().openapi({ example: 426.64 }),
    changePct: z.number().nullable().openapi({ example: 1.44 }),
    prevClose: z.number().nullable().openapi({ example: 420.6 }),
    volume: z.number().nullable().openapi({ example: 8153033 }),
    avgVolume: z.number().nullable().openapi({ example: 56280000 }),
    fiftyTwoWHigh: z.number().nullable().openapi({ example: 498.83 }),
    fiftyTwoWLow: z.number().nullable().openapi({ example: 288.77 }),
    marketCap: z.number().nullable().openapi({ example: 1579655830000 }),
    peRatio: z.number().nullable().openapi({ example: 389.77 }),
    forwardPe: z.number().nullable().openapi({ example: 176.09 }),
    pegRatio: z.number().nullable().openapi({ example: 7.18 }),
    psRatio: z.number().nullable().openapi({ example: 16.37 }),
    pbRatio: z.number().nullable().openapi({ example: 19.05 }),
    dividendYield: z.number().nullable().openapi({ example: 0.0 }),
    financials: z
      .record(z.string(), z.any())
      .openapi("TickerFinancials", { example: { pe_ratio: 389.77, forward_pe: 176.09 } }),
    createdAt: z.string().openapi({ example: "2026-07-01T12:00:00Z" }),
    updatedAt: z.string().openapi({ example: "2026-07-01T12:00:00Z" }),
  })
  .openapi("Ticker");

export const TickerRelationInfoSchema = z
  .object({
    symbol: z.string().openapi({ example: "TSLL" }),
    name: z.string().openapi({ example: "Direxion Daily TSLA Bull 2X Shares" }),
    relationType: RelationTypeEnum.openapi({ example: "x2" }),
    multiplier: z.number().openapi({ example: 2.0 }),
  })
  .openapi("TickerRelationInfo");

export const TickerDetailSchema = TickerSchema.extend({
  relations: z.array(TickerRelationInfoSchema).describe("Activos relacionados directos."),
  plans: z.array(z.string()).describe("Slugs de planes en los que está incluido."),
}).openapi("TickerDetail");

export const ListTickersQuerySchema = z.object({
  q: z.string().optional().openapi({ description: "Búsqueda por símbolo o nombre." }),
  assetClass: AssetClassEnum.optional().openapi({ description: "Filtrar por clase de activo." }),
  sector: z.string().optional().openapi({ description: "Filtrar por sector." }),
  planSlug: z
    .string()
    .optional()
    .openapi({ description: "Filtrar activos incluidos en un plan de Investep." }),
  page: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .openapi({ description: "Página (default 1)." }),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .openapi({ description: "Límite por página (default 20)." }),
});

export const TickersPaginatedResponseSchema = z
  .object({
    tickers: z.array(TickerSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
    }),
  })
  .openapi("TickersPaginatedResponse");

export const CreateTickerSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .regex(/^[A-Z0-9.-]+$/, "Símbolo de activo inválido (solo A-Z, 0-9, . o -).")
      .openapi({ example: "TSLA" }),
    name: z.string().trim().min(1).openapi({ example: "Tesla, Inc." }),
    assetClass: AssetClassEnum.default("stock"),
    exchange: z.string().optional(),
    sector: z.string().optional(),
    industry: z.string().optional(),
    country: z.string().optional(),
    price: z.number().optional(),
    changePct: z.number().optional(),
    prevClose: z.number().optional(),
    volume: z.number().optional(),
    avgVolume: z.number().optional(),
    fiftyTwoWHigh: z.number().optional(),
    fiftyTwoWLow: z.number().optional(),
    marketCap: z.number().optional(),
    peRatio: z.number().optional(),
    forwardPe: z.number().optional(),
    pegRatio: z.number().optional(),
    psRatio: z.number().optional(),
    pbRatio: z.number().optional(),
    dividendYield: z.number().optional(),
    financials: z.record(z.string(), z.any()).optional().default({}),
  })
  .openapi("CreateTicker");

export const UpdateTickerSchema = CreateTickerSchema.partial().openapi("UpdateTicker");

export const RelationPayloadSchema = z
  .object({
    relatedTickerId: z.number().int().positive().openapi({ example: 2 }),
    relationType: RelationTypeEnum.openapi({ example: "x2" }),
    multiplier: z.number().default(1.0).openapi({ example: 2.0 }),
  })
  .openapi("RelationPayload");

export const RelationDeletePayloadSchema = z
  .object({
    relatedTickerId: z.number().int().positive().openapi({ example: 2 }),
    relationType: RelationTypeEnum.openapi({ example: "x2" }),
  })
  .openapi("RelationDeletePayload");

export const PlanAssociationPayloadSchema = z
  .object({
    planId: z.number().int().positive().openapi({ example: 3 }),
  })
  .openapi("PlanAssociationPayload");

const TickerSymbolParamSchema = z.object({
  symbol: z
    .string()
    .toUpperCase()
    .openapi({
      param: { name: "symbol", in: "path" },
      example: "TSLA",
      description: "Símbolo del ticker (ej. TSLA).",
    }),
});

const TickerIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 1,
      description: "ID numérico del ticker.",
    }),
});

// --- ROUTES ---

// GET /tickers
export const listTickersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tickers"],
  summary: "Buscar y listar activos",
  description:
    "Lista activos con soporte para paginación, filtros de sector/clase y asignación de plan.",
  security: [{ bearerAuth: [] }],
  request: { query: ListTickersQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: TickersPaginatedResponseSchema } },
      description: "Lista paginada de activos.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// GET /tickers/{symbol}
export const getTickerRoute = createRoute({
  method: "get",
  path: "/{symbol}",
  tags: ["Tickers"],
  summary: "Obtener detalle de un activo",
  description:
    "Obtiene el detalle completo de un activo a partir de su símbolo, incluyendo sus tickers relacionados y planes asociados.",
  security: [{ bearerAuth: [] }],
  request: { params: TickerSymbolParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: TickerDetailSchema } },
      description: "Detalle del activo.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    404: jsonErrorResponse("El activo no existe (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// POST /admin/tickers
export const createTickerRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tickers", "Admin"],
  summary: "Crear un nuevo activo (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateTickerSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ ticker: TickerSchema }) } },
      description: "Activo creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("El símbolo del ticker ya existe (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// PATCH /admin/tickers/{id}
export const updateTickerRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Tickers", "Admin"],
  summary: "Actualizar un activo (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: TickerIdParamSchema,
    body: { content: { "application/json": { schema: UpdateTickerSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ticker: TickerSchema }) } },
      description: "Activo actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("El activo no existe (`NOT_FOUND`)."),
    409: jsonErrorResponse("El símbolo del ticker colisiona con otro (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// DELETE /admin/tickers/{id}
export const deleteTickerRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Tickers", "Admin"],
  summary: "Eliminar un activo (admin)",
  security: [{ bearerAuth: [] }],
  request: { params: TickerIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Activo eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("El activo no existe (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// POST /admin/tickers/{id}/relations
export const associateRelationRoute = createRoute({
  method: "post",
  path: "/{id}/relations",
  tags: ["Tickers", "Admin"],
  summary: "Asociar un activo relacionado (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: TickerIdParamSchema,
    body: { content: { "application/json": { schema: RelationPayloadSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ associated: z.literal(true) }) } },
      description: "Relación establecida.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("El activo principal o el relacionado no existen (`NOT_FOUND`)."),
    409: jsonErrorResponse("La relación ya existe (`CONFLICT`)."),
    422: jsonErrorResponse("Intento de autorrelación o parámetros inválidos (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// DELETE /admin/tickers/{id}/relations
export const disassociateRelationRoute = createRoute({
  method: "delete",
  path: "/{id}/relations",
  tags: ["Tickers", "Admin"],
  summary: "Remover una relación entre activos (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: TickerIdParamSchema,
    body: {
      content: { "application/json": { schema: RelationDeletePayloadSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ disassociated: z.literal(true) }) } },
      description: "Relación eliminada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("La relación no existe (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// POST /admin/tickers/{id}/plans
export const associatePlanRoute = createRoute({
  method: "post",
  path: "/{id}/plans",
  tags: ["Tickers", "Admin"],
  summary: "Asociar activo a un plan de Investep (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: TickerIdParamSchema,
    body: {
      content: { "application/json": { schema: PlanAssociationPayloadSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ associated: z.literal(true) }) } },
      description: "Asociación del plan creada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("El activo o el plan de Investep no existen (`NOT_FOUND`)."),
    409: jsonErrorResponse("La asociación con el plan ya existe (`CONFLICT`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

// DELETE /admin/tickers/{id}/plans
export const disassociatePlanRoute = createRoute({
  method: "delete",
  path: "/{id}/plans",
  tags: ["Tickers", "Admin"],
  summary: "Remover activo de un plan de Investep (admin)",
  security: [{ bearerAuth: [] }],
  request: {
    params: TickerIdParamSchema,
    body: {
      content: { "application/json": { schema: PlanAssociationPayloadSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ disassociated: z.literal(true) }) } },
      description: "Asociación del plan eliminada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("Se requiere acceso de administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("La asociación entre activo y plan no existe (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});

export type ListTickersRoute = typeof listTickersRoute;
export type GetTickerRoute = typeof getTickerRoute;
export type CreateTickerRoute = typeof createTickerRoute;
export type UpdateTickerRoute = typeof updateTickerRoute;
export type DeleteTickerRoute = typeof deleteTickerRoute;
export type AssociateRelationRoute = typeof associateRelationRoute;
export type DisassociateRelationRoute = typeof disassociateRelationRoute;
export type AssociatePlanRoute = typeof associatePlanRoute;
export type DisassociatePlanRoute = typeof disassociatePlanRoute;
