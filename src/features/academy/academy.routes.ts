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

// La columna es numeric(10,2): máximo 99_999_999.99 y 2 decimales. Sin estos límites: un valor
// mayor revienta como 22003 → 500; y >2 decimales se redondea en la DB pero el PATCH arma su
// respuesta en memoria (sin re-leer), así que devolvería un precio que NO coincide con lo guardado.
// `multipleOf(0.01)` lo corta como 422 y mantiene respuesta == DB.
const PRICE_MAX = 99_999_999.99;
const PriceSchema = z.number().nonnegative().max(PRICE_MAX).multipleOf(0.01);

// Rechaza locales repetidos en un mismo payload: el upsert con dos filas (plan_id, locale)
// dispara 21000 (cardinality_violation) → 500. Mejor cortarlo como 422 acá.
const hasUniqueLocales = (arr: { locale: string }[]) =>
  new Set(arr.map((t) => t.locale)).size === arr.length;
const DUPLICATE_LOCALE_MSG = "No repitas el mismo locale en translations.";

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
    url: z.string().nullable().openapi({ example: "https://checkout.stripe.com/pay/cs_live_123" }),
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
    url: z.string().nullable().openapi({ example: "https://checkout.stripe.com/pay/cs_live_123" }),
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
    url: z
      .string()
      .url()
      .nullable()
      .optional()
      .openapi({ description: "URL externa de suscripción del plan." }),
    priceRegular: PriceSchema.openapi({ example: 199.0 }),
    priceOffer: PriceSchema.nullable().optional().openapi({ example: 149.0 }),
    currency: CurrencySchema.optional().openapi({ description: "Default 'USD' si se omite." }),
    sortOrder: z.number().int().nonnegative().optional().openapi({ example: 3 }),
    isActive: z.boolean().optional().openapi({ example: true }),
    translations: z
      .array(AcademyPlanTranslationSchema)
      .min(1)
      .refine(hasUniqueLocales, { message: DUPLICATE_LOCALE_MSG })
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
    url: z
      .string()
      .url()
      .nullable()
      .optional()
      .openapi({ description: "URL externa de suscripción del plan." }),
    priceRegular: PriceSchema.optional(),
    priceOffer: PriceSchema.nullable().optional(),
    currency: CurrencySchema.optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
    translations: z
      .array(AcademyPlanTranslationSchema)
      .min(1)
      .refine(hasUniqueLocales, { message: DUPLICATE_LOCALE_MSG })
      .optional(),
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
  path: "/plans",
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
  path: "/plans",
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
  path: "/plans/{id}",
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
  path: "/plans/{id}",
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

// --- Administración de Características (Features) ---

export const AcademyFeatureTranslationSchema = z
  .object({
    locale: z.string().min(2).max(10).openapi({ example: "es" }),
    label: z.string().min(1).openapi({ example: "Comunidad" }),
  })
  .openapi("AcademyFeatureTranslation");

export const AcademyFeatureAdminSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    slug: SlugSchema,
    sortOrder: z.number().openapi({ example: 0 }),
    translations: z.array(AcademyFeatureTranslationSchema),
  })
  .openapi("AcademyFeatureAdmin");

export const CreateAcademyFeatureSchema = z
  .object({
    slug: SlugSchema,
    sortOrder: z.number().int().nonnegative().optional().default(0).openapi({ example: 0 }),
    translations: z
      .array(AcademyFeatureTranslationSchema)
      .min(1)
      .refine(hasUniqueLocales, { message: DUPLICATE_LOCALE_MSG })
      .openapi({ description: "Traducciones de la característica (mínimo 1)." }),
  })
  .openapi("CreateAcademyFeature");

export const UpdateAcademyFeatureSchema = z
  .object({
    sortOrder: z.number().int().nonnegative().optional(),
    translations: z
      .array(AcademyFeatureTranslationSchema)
      .min(1)
      .refine(hasUniqueLocales, { message: DUPLICATE_LOCALE_MSG })
      .optional()
      .openapi({ description: "Traducciones de la característica (mínimo 1 si se envía)." }),
  })
  .openapi("UpdateAcademyFeature");

const AcademyFeatureIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 1,
      description: "Id de la característica.",
    }),
});

const AcademyFeatureEnvelopeSchema = z
  .object({ feature: AcademyFeatureAdminSchema })
  .openapi("AcademyFeatureEnvelope");

const AcademyFeaturesAdminResponseSchema = z
  .object({ features: z.array(AcademyFeatureAdminSchema) })
  .openapi("AcademyFeaturesAdminResponse");

// --- GET /admin/academy/features (admin) ---
export const listAcademyFeaturesRoute = createRoute({
  method: "get",
  path: "/features",
  tags: ["Academy", "Admin"],
  summary: "Listar características (admin)",
  description:
    "Lista todas las características ordenadas por `sort_order` con todas sus traducciones. " +
    "SOLO administradores (**403**).",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: AcademyFeaturesAdminResponseSchema } },
      description: "Todas las características.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type ListAcademyFeaturesRoute = typeof listAcademyFeaturesRoute;

// --- POST /admin/academy/features (admin) ---
export const createAcademyFeatureRoute = createRoute({
  method: "post",
  path: "/features",
  tags: ["Academy", "Admin"],
  summary: "Crear una característica (admin)",
  description:
    "Crea una característica con sus traducciones. SOLO administradores (**403**). " +
    "`slug` único → **409**. Locales inexistentes en la DB → **422**.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreateAcademyFeatureSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: AcademyFeatureEnvelopeSchema } },
      description: "Característica creada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("Ya existe una característica con ese slug (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida o locales inexistentes (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type CreateAcademyFeatureRoute = typeof createAcademyFeatureRoute;

// --- PATCH /admin/academy/features/{id} (admin) ---
export const updateAcademyFeatureRoute = createRoute({
  method: "patch",
  path: "/features/{id}",
  tags: ["Academy", "Admin"],
  summary: "Actualizar una característica (admin)",
  description:
    "Actualización parcial de la característica (orden y/o traducciones). " +
    "SOLO administradores (**403**). `slug` NO es editable.",
  security: [{ bearerAuth: [] }],
  request: {
    params: AcademyFeatureIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateAcademyFeatureSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: AcademyFeatureEnvelopeSchema } },
      description: "Característica actualizada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe una característica con ese id (`NOT_FOUND`)."),
    422: jsonErrorResponse("Entrada inválida o locales inexistentes (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type UpdateAcademyFeatureRoute = typeof updateAcademyFeatureRoute;

// --- DELETE /admin/academy/features/{id} (admin) ---
export const deleteAcademyFeatureRoute = createRoute({
  method: "delete",
  path: "/features/{id}",
  tags: ["Academy", "Admin"],
  summary: "Eliminar una característica (admin)",
  description:
    "Baja de una característica; traducciones y asociaciones caen por `ON DELETE CASCADE`. " +
    "SOLO administradores (**403**).",
  security: [{ bearerAuth: [] }],
  request: { params: AcademyFeatureIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Característica eliminada.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe una característica con ese id (`NOT_FOUND`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type DeleteAcademyFeatureRoute = typeof deleteAcademyFeatureRoute;
