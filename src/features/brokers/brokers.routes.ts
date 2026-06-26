import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo.")
  .openapi({ example: "interactive-brokers", description: "Identificador estable y URL-safe." });

/**
 * Vista pública de un broker. `logo`/`favicon`/`icon` son strings libres (NO `.url()`):
 * pueden ser una URL http(s) o un `data:` URI embebido (caso eTrade en el seed).
 */
export const BrokerSchema = z
  .object({
    id: z.number().openapi({ example: 2, description: "Id numérico autogenerado." }),
    slug: SlugSchema,
    name: z.string().openapi({ example: "Interactive Brokers", description: "Nombre visible." }),
    url: z
      .string()
      .url()
      .openapi({ example: "https://www.interactivebrokers.com/", description: "Sitio principal." }),
    urlSecondary: z
      .string()
      .url()
      .nullable()
      .openapi({ example: "https://www.interactivebrokers.ie/", description: "Dominio regional." }),
    logo: z
      .string()
      .nullable()
      .openapi({ example: "https://.../logo.svg", description: "URL o `data:` URI del logo." }),
    favicon: z.string().nullable().openapi({
      example: "https://.../favicon.png",
      description: "URL o `data:` URI del favicon.",
    }),
    icon: z
      .string()
      .nullable()
      .openapi({ example: "https://.../icon.png", description: "URL o `data:` URI del ícono." }),
  })
  .openapi("Broker");

export const BrokersResponseSchema = z
  .object({ brokers: z.array(BrokerSchema) })
  .openapi("BrokersResponse");

const BrokerEnvelopeSchema = z.object({ broker: BrokerSchema }).openapi("BrokerEnvelope");

/** Cuerpo de creación: `slug`, `name` y `url` requeridos; imágenes y dominio secundario opcionales. */
export const CreateBrokerSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().min(1).openapi({ example: "Interactive Brokers" }),
    url: z.string().url().openapi({ example: "https://www.interactivebrokers.com/" }),
    urlSecondary: z.string().url().nullable().optional().openapi({ example: null }),
    logo: z.string().nullable().optional().openapi({ example: null }),
    favicon: z.string().nullable().optional().openapi({ example: null }),
    icon: z.string().nullable().optional().openapi({ example: null }),
  })
  .openapi("CreateBroker");

/** Cuerpo de actualización: PATCH parcial. Todos los campos opcionales (`partial` del create). */
export const UpdateBrokerSchema = CreateBrokerSchema.partial().openapi("UpdateBroker");

const IdOrSlugParamSchema = z.object({
  idOrSlug: z.string().openapi({
    param: { name: "idOrSlug", in: "path" },
    example: "interactive-brokers",
    description: "Id numérico o slug del broker.",
  }),
});

const IdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 2,
      description: "Id numérico del broker.",
    }),
});

// --- GET /brokers (cliente) ---
export const listBrokersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Brokers"],
  summary: "Listar brokers",
  description:
    "Catálogo de brokers soportados, ordenado por nombre. Lo consume el frontend en el paso " +
    "'Elegí tu broker' del setup. Requiere usuario autenticado (cualquiera, no admin).",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: BrokersResponseSchema } },
      description: "Brokers disponibles.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type ListBrokersRoute = typeof listBrokersRoute;

// --- GET /brokers/{idOrSlug} (cliente) ---
export const getBrokerRoute = createRoute({
  method: "get",
  path: "/{idOrSlug}",
  tags: ["Brokers"],
  summary: "Obtener un broker",
  description: "Devuelve un broker por su id numérico o por su slug. Requiere usuario autenticado.",
  security: [{ bearerAuth: [] }],
  request: { params: IdOrSlugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: BrokerEnvelopeSchema } },
      description: "Broker encontrado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    404: jsonErrorResponse("No existe un broker con ese id/slug (`NOT_FOUND`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type GetBrokerRoute = typeof getBrokerRoute;

// --- POST /admin/brokers (admin) ---
export const createBrokerRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Brokers", "Admin"],
  summary: "Crear un broker (admin)",
  description:
    "Alta de un broker en el catálogo. SOLO administradores (`app_metadata.is_admin`); un usuario " +
    "autenticado no-admin recibe **403** (`FORBIDDEN`). El `slug` debe ser único.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateBrokerSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: BrokerEnvelopeSchema } },
      description: "Broker creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("Ya existe un broker con ese slug (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type CreateBrokerRoute = typeof createBrokerRoute;

// --- PATCH /admin/brokers/{id} (admin) ---
export const updateBrokerRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Brokers", "Admin"],
  summary: "Actualizar un broker (admin)",
  description:
    "Actualización parcial de un broker. SOLO administradores (**403** si no lo es). Enviá solo los " +
    "campos a cambiar; un `null` explícito limpia el campo (logo/favicon/icon/urlSecondary).",
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: UpdateBrokerSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BrokerEnvelopeSchema } },
      description: "Broker actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un broker con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El slug ya está en uso por otro broker (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type UpdateBrokerRoute = typeof updateBrokerRoute;

// --- DELETE /admin/brokers/{id} (admin) ---
export const deleteBrokerRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Brokers", "Admin"],
  summary: "Eliminar un broker (admin)",
  description:
    "Baja de un broker del catálogo. SOLO administradores (**403** si no lo es). Si hay asignaciones " +
    "de usuarios que referencian este broker, la FK impedirá el borrado y se devuelve **409**.",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Broker eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un broker con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El broker está referenciado por asignaciones (`CONFLICT`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type DeleteBrokerRoute = typeof deleteBrokerRoute;
