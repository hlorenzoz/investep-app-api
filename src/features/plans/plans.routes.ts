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

// --- Administración del catálogo (admin-only) ---

const PlanTranslationSchema = z
  .object({
    locale: z.string().min(2).max(10).openapi({ example: "es", description: "Código de locale." }),
    label: z
      .string()
      .min(1)
      .openapi({ example: "Activos 25% mensual", description: "Label visible." }),
  })
  .openapi("PlanTranslation");

export const PlanAdminSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    accountType: AccountTypeEnum.openapi({ example: "equity" }),
    targetMonthlyPct: z.number().positive().openapi({ example: 25 }),
    targetDailyPct: z.number().nullable().openapi({
      example: 1.25,
      description: "Calculado por trigger (equity); null para options.",
    }),
    translations: z.array(PlanTranslationSchema),
  })
  .openapi("PlanAdmin");

const PlanEnvelopeSchema = z.object({ plan: PlanAdminSchema }).openapi("PlanEnvelope");

/** Cuerpo de creación: tipo de cuenta, target mensual y al menos una traducción. */
export const CreatePlanSchema = z
  .object({
    accountType: AccountTypeEnum.openapi({ example: "equity" }),
    targetMonthlyPct: z.number().positive().openapi({ example: 25 }),
    translations: z
      .array(PlanTranslationSchema)
      .min(1)
      .openapi({ description: "Labels por locale (recomendado: es y en)." }),
  })
  .openapi("CreatePlan");

/** Cuerpo de actualización: PATCH parcial. `accountType` NO es editable (integridad de FK). */
export const UpdatePlanSchema = z
  .object({
    targetMonthlyPct: z.number().positive().optional().openapi({ example: 30 }),
    translations: z.array(PlanTranslationSchema).min(1).optional(),
  })
  .openapi("UpdatePlan");

const PlanIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 1,
      description: "Id numérico del plan.",
    }),
});

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
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});

export type ListPlansRoute = typeof listPlansRoute;

// --- POST /admin/plans (admin) ---
export const createPlanRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Plans", "Admin"],
  summary: "Crear un plan (admin)",
  description:
    "Alta de un plan de inversión con sus traducciones. SOLO administradores " +
    "(`app_metadata.is_admin`); un no-admin recibe **403** (`FORBIDDEN`). El par " +
    "(`accountType`, `targetMonthlyPct`) debe ser único. `targetDailyPct` lo calcula un trigger.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreatePlanSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: PlanEnvelopeSchema } },
      description: "Plan creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse(
      "Ya existe un plan con ese tipo de cuenta y target mensual (`CONFLICT`).",
    ),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type CreatePlanRoute = typeof createPlanRoute;

// --- PATCH /admin/plans/{id} (admin) ---
export const updatePlanRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Plans", "Admin"],
  summary: "Actualizar un plan (admin)",
  description:
    "Actualización parcial de un plan: `targetMonthlyPct` (el trigger recalcula `targetDailyPct`) " +
    "y/o traducciones (upsert por locale). SOLO administradores (**403** si no lo es). `accountType` " +
    "NO es editable (integridad de FK).",
  security: [{ bearerAuth: [] }],
  request: {
    params: PlanIdParamSchema,
    body: { content: { "application/json": { schema: UpdatePlanSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: PlanEnvelopeSchema } },
      description: "Plan actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un plan con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El par (tipo de cuenta, target mensual) ya existe (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type UpdatePlanRoute = typeof updatePlanRoute;

// --- DELETE /admin/plans/{id} (admin) ---
export const deletePlanRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Plans", "Admin"],
  summary: "Eliminar un plan (admin)",
  description:
    "Baja de un plan; sus traducciones caen por `ON DELETE CASCADE`. SOLO administradores " +
    "(**403** si no lo es). Si hay asignaciones que referencian el plan, la FK impide el borrado (**409**).",
  security: [{ bearerAuth: [] }],
  request: { params: PlanIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Plan eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un plan con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El plan está referenciado por asignaciones (`CONFLICT`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type DeletePlanRoute = typeof deletePlanRoute;
