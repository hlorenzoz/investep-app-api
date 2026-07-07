import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo.")
  .openapi({ example: "habitos-atomicos", description: "Identificador estable y URL-safe." });

/**
 * Vista pública de un libro recomendado. `image` es un path relativo a `assets/images/`
 * (mismo contrato que `products.image`: la API publica el path completo con extensión y el
 * frontend resuelve el asset; NO es una URL absoluta como `brokers.logo`).
 */
export const RecommendedBookSchema = z
  .object({
    id: z.number().openapi({ example: 12, description: "Id numérico autogenerado." }),
    slug: SlugSchema,
    title: z
      .string()
      .openapi({ example: "Hábitos atómicos", description: "Título visible del libro." }),
    author: z.string().openapi({ example: "James Clear", description: "Autor(es) del libro." }),
    description: z.string().openapi({
      example:
        "Un enfoque práctico sobre cómo los pequeños hábitos diarios generan grandes cambios.",
      description: "Reseña editorial curada.",
    }),
    url: z.string().url().openapi({
      example: "https://www.youtube.com/results?search_query=habitos+atomicos+audiolibro+espanol",
      description: "Enlace externo: búsqueda del audiolibro en YouTube o ficha de Amazon.",
    }),
    image: z.string().openapi({
      example: "books/habitos-atomicos.webp",
      description: "Path de la portada, relativo a `assets/images/`.",
    }),
    sortOrder: z.number().int().openapi({
      example: 12,
      description: "Posición en el orden editorial de la lista (ascendente).",
    }),
  })
  .openapi("RecommendedBook");

export const RecommendedBooksResponseSchema = z
  .object({ recommendedBooks: z.array(RecommendedBookSchema) })
  .openapi("RecommendedBooksResponse");

const RecommendedBookEnvelopeSchema = z
  .object({ recommendedBook: RecommendedBookSchema })
  .openapi("RecommendedBookEnvelope");

/** Cuerpo de creación: todos los campos de contenido requeridos; `sortOrder` opcional (default 0). */
export const CreateRecommendedBookSchema = z
  .object({
    slug: SlugSchema,
    title: z.string().min(1).openapi({ example: "Hábitos atómicos" }),
    author: z.string().min(1).openapi({ example: "James Clear" }),
    description: z.string().min(1).openapi({
      example:
        "Un enfoque práctico sobre cómo los pequeños hábitos diarios generan grandes cambios.",
    }),
    url: z.string().url().openapi({
      example: "https://www.youtube.com/results?search_query=habitos+atomicos+audiolibro+espanol",
    }),
    image: z.string().min(1).openapi({ example: "books/habitos-atomicos.webp" }),
    sortOrder: z.number().int().nonnegative().optional().openapi({ example: 12 }),
  })
  .openapi("CreateRecommendedBook");

/** Cuerpo de actualización: PATCH parcial. Todos los campos opcionales (`partial` del create). */
export const UpdateRecommendedBookSchema =
  CreateRecommendedBookSchema.partial().openapi("UpdateRecommendedBook");

const IdOrSlugParamSchema = z.object({
  idOrSlug: z.string().openapi({
    param: { name: "idOrSlug", in: "path" },
    example: "habitos-atomicos",
    description: "Id numérico o slug del libro.",
  }),
});

const IdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 12,
      description: "Id numérico del libro.",
    }),
});

// --- GET /recommended-books (cliente) ---
export const listRecommendedBooksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Recommended Books"],
  summary: "Listar libros recomendados",
  description:
    "Lista curada de libros recomendados (investepacademy.com/librostransformacion), ordenada por " +
    "`sortOrder` ascendente (orden editorial, no alfabético). Cada libro enlaza a un recurso " +
    "externo: búsqueda del audiolibro en YouTube o ficha de Amazon. Requiere usuario autenticado " +
    "(cualquiera, no admin).",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: RecommendedBooksResponseSchema } },
      description: "Libros recomendados disponibles.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type ListRecommendedBooksRoute = typeof listRecommendedBooksRoute;

// --- GET /recommended-books/{idOrSlug} (cliente) ---
export const getRecommendedBookRoute = createRoute({
  method: "get",
  path: "/{idOrSlug}",
  tags: ["Recommended Books"],
  summary: "Obtener un libro recomendado",
  description:
    "Devuelve un libro recomendado por su id numérico o por su slug. Requiere usuario autenticado.",
  security: [{ bearerAuth: [] }],
  request: { params: IdOrSlugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: RecommendedBookEnvelopeSchema } },
      description: "Libro encontrado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    404: jsonErrorResponse("No existe un libro con ese id/slug (`NOT_FOUND`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type GetRecommendedBookRoute = typeof getRecommendedBookRoute;

// --- POST /admin/recommended-books (admin) ---
export const createRecommendedBookRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Recommended Books", "Admin"],
  summary: "Crear un libro recomendado (admin)",
  description:
    "Alta de un libro en la lista curada. SOLO administradores (`app_metadata.is_admin`); un " +
    "usuario autenticado no-admin recibe **403** (`FORBIDDEN`). El `slug` debe ser único. Si no " +
    "se envía `sortOrder`, el libro queda al inicio (0).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreateRecommendedBookSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: RecommendedBookEnvelopeSchema } },
      description: "Libro creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("Ya existe un libro con ese slug (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type CreateRecommendedBookRoute = typeof createRecommendedBookRoute;

// --- PATCH /admin/recommended-books/{id} (admin) ---
export const updateRecommendedBookRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Recommended Books", "Admin"],
  summary: "Actualizar un libro recomendado (admin)",
  description:
    "Actualización parcial de un libro. SOLO administradores (**403** si no lo es). Enviá solo " +
    "los campos a cambiar; `sortOrder` permite reordenar la lista sin tocar el contenido.",
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateRecommendedBookSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RecommendedBookEnvelopeSchema } },
      description: "Libro actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un libro con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El slug ya está en uso por otro libro (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type UpdateRecommendedBookRoute = typeof updateRecommendedBookRoute;

// --- DELETE /admin/recommended-books/{id} (admin) ---
export const deleteRecommendedBookRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Recommended Books", "Admin"],
  summary: "Eliminar un libro recomendado (admin)",
  description: "Baja de un libro de la lista curada. SOLO administradores (**403** si no lo es).",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Libro eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un libro con ese id (`NOT_FOUND`)."),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá.",
    ),
  },
});
export type DeleteRecommendedBookRoute = typeof deleteRecommendedBookRoute;
