import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

// Validaciones alineadas con los CHECK de la migración (20260624054442) para fallar como
// 422 (input inválido) antes de llegar a la DB, en vez de un 500/violación opaco.
const SlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_-]+$/)
  .openapi({ example: "gold", description: "Identificador estable (a-z, 0-9, _ , -)." });
const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .openapi({ example: "USD", description: "Código ISO 4217 (3 letras mayúsculas)." });

export const ListAcademyPlansQuerySchema = z.object({
  locale: z.string().min(2).max(10).optional().openapi({ example: "es" }),
});

// --- Vista cliente (GET /academy/plans) ---

const AcademyFeatureSchema = z
  .object({
    id: z.number().openapi({ example: 12 }),
    slug: z.string().openapi({ example: "live_sessions" }),
    label: z.string().nullable().openapi({ example: "Sesiones en vivo" }),
  })
  .openapi("AcademyFeature");

export const AcademyPlanSchema = z
  .object({
    id: z.number().openapi({ example: 3 }),
    slug: z.string().openapi({ example: "gold" }),
    name: z.string().nullable().openapi({ example: "Gold" }),
    subtitle: z.string().nullable().openapi({ example: "Para traders activos" }),
    priceRegular: z.number().openapi({ example: 199.0 }),
    priceOffer: z.number().nullable().openapi({ example: 149.0 }),
    currency: z.string().openapi({ example: "USD" }),
    features: z.array(AcademyFeatureSchema),
  })
  .openapi("AcademyPlan");

export const AcademyPlansResponseSchema = z
  .object({
    locale: z.string().openapi({ example: "es" }),
    plans: z.array(AcademyPlanSchema),
  })
  .openapi("AcademyPlansResponse");

// --- Administración (admin-only) ---

const AcademyPlanTranslationSchema = z
  .object({
    locale: z.string().min(2).max(10).openapi({ example: "es" }),
    name: z.string().min(1).openapi({ example: "Gold" }),
    subtitle: z.string().nullable().optional().openapi({ example: "Para traders activos" }),
  })
  .openapi("AcademyPlanTranslation");

export const AcademyPlanAdminSchema = z
  .object({
    id: z.number().openapi({ example: 3 }),
    slug: z.string().openapi({ example: "gold" }),
    priceRegular: z.number().openapi({ example: 199.0 }),
    priceOffer: z.number().nullable().openapi({ example: 149.0 }),
    currency: z.string().openapi({ example: "USD" }),
    sortOrder: z.number().openapi({ example: 3 }),
    isActive: z.boolean().openapi({ example: true }),
    translations: z.array(AcademyPlanTranslationSchema),
    featureIds: z.array(z.number().int().positive()).openapi({ example: [1, 2, 5] }),
  })
  .openapi("AcademyPlanAdmin");

const AcademyPlanEnvelopeSchema = z
  .object({ plan: AcademyPlanAdminSchema })
  .openapi("AcademyPlanEnvelope");

const AcademyPlansAdminResponseSchema = z
  .object({ plans: z.array(AcademyPlanAdminSchema) })
  .openapi("AcademyPlansAdminResponse");

/** Cuerpo de creación: precios + estado/orden opcionales, al menos una traducción, ids de features. */
export const CreateAcademyPlanSchema = z
  .object({
    slug: SlugSchema,
    priceRegular: z.number().nonnegative().openapi({ example: 199.0 }),
    priceOffer: z.number().nonnegative().nullable().optional().openapi({ example: 149.0 }),
    currency: CurrencySchema.optional().openapi({ description: "Default 'USD' si se omite." }),
    sortOrder: z.number().int().optional().openapi({ example: 3 }),
    isActive: z.boolean().optional().openapi({ example: true }),
    translations: z
      .array(AcademyPlanTranslationSchema)
      .min(1)
      .openapi({ description: "Textos por locale (recomendado: es y en)." }),
    featureIds: z
      .array(z.number().int().positive())
      .default([])
      .openapi({ description: "Ids de las features incluidas en el paquete." }),
  })
  .openapi("CreateAcademyPlan");

/** Cuerpo de actualización: PATCH parcial. `slug` NO es editable (identificador estable). */
export const UpdateAcademyPlanSchema = z
  .object({
    priceRegular: z.number().nonnegative().optional(),
    priceOffer: z.number().nonnegative().nullable().optional(),
    currency: CurrencySchema.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    translations: z.array(AcademyPlanTranslationSchema).min(1).optional(),
    featureIds: z
      .array(z.number().int().positive())
      .optional()
      .openapi({ description: "Si se envía, reemplaza el set completo de features." }),
  })
  .openapi("UpdateAcademyPlan");

const AcademyPlanIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "id", in: "path" }, example: 3, description: "Id del paquete." }),
});

// --- GET /academy/plans (cliente) ---
export const listAcademyPlansRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Academy"],
  summary: "Listar paquetes de la Academia",
  description:
    "Catálogo de paquetes de membresía ACTIVOS, ordenados por `sort_order`, con sus textos " +
    "localizados y la matriz de features incluidas. `locale` por defecto `es`.",
  security: [{ bearerAuth: [] }],
  request: { query: ListAcademyPlansQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: AcademyPlansResponseSchema } },
      description: "Paquetes disponibles.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type ListAcademyPlansRoute = typeof listAcademyPlansRoute;

// --- GET /admin/academy/plans (admin) ---
export const listAcademyPlansAdminRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Academy", "Admin"],
  summary: "Listar paquetes (admin)",
  description:
    "Lista TODOS los paquetes (activos e inactivos) con todas sus traducciones e ids de features. " +
    "SOLO administradores (**403** si no lo es).",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: AcademyPlansAdminResponseSchema } },
      description: "Todos los paquetes.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type ListAcademyPlansAdminRoute = typeof listAcademyPlansAdminRoute;

// --- POST /admin/academy/plans (admin) ---
export const createAcademyPlanRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Academy", "Admin"],
  summary: "Crear un paquete (admin)",
  description:
    "Alta de un paquete con sus precios, traducciones e ids de features. SOLO administradores " +
    "(**403**). `slug` único → **409**. Un id de feature inexistente → **422**.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateAcademyPlanSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: AcademyPlanEnvelopeSchema } },
      description: "Paquete creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("Ya existe un paquete con ese slug (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida o feature inexistente (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type CreateAcademyPlanRoute = typeof createAcademyPlanRoute;

// --- PATCH /admin/academy/plans/{id} (admin) ---
export const updateAcademyPlanRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Academy", "Admin"],
  summary: "Actualizar un paquete (admin)",
  description:
    "Actualización parcial: precios, estado, orden, traducciones (upsert por locale) y/o la lista " +
    "de features (reemplazo total del set). SOLO administradores (**403**). `slug` NO es editable.",
  security: [{ bearerAuth: [] }],
  request: {
    params: AcademyPlanIdParamSchema,
    body: { content: { "application/json": { schema: UpdateAcademyPlanSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: AcademyPlanEnvelopeSchema } },
      description: "Paquete actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un paquete con ese id (`NOT_FOUND`)."),
    422: jsonErrorResponse("Entrada inválida o feature inexistente (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type UpdateAcademyPlanRoute = typeof updateAcademyPlanRoute;

// --- DELETE /admin/academy/plans/{id} (admin) ---
export const deleteAcademyPlanRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Academy", "Admin"],
  summary: "Eliminar un paquete (admin)",
  description:
    "Baja de un paquete; traducciones y features asociadas caen por `ON DELETE CASCADE`. SOLO " +
    "administradores (**403**). Si una membresía referencia el paquete, la FK impide el borrado (**409**).",
  security: [{ bearerAuth: [] }],
  request: { params: AcademyPlanIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Paquete eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un paquete con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El paquete está referenciado por una membresía (`CONFLICT`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type DeleteAcademyPlanRoute = typeof deleteAcademyPlanRoute;
