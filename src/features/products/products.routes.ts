import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

export const CategoryEnum = z.enum(["book", "tshirt", "cap"]);
export const GenderEnum = z.enum(["men", "women"]);
export const ThemeEnum = z.enum(["light", "dark"]);

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo.")
  .openapi({
    example: "libro-invertir-con-cabeza",
    description: "Identificador estable y URL-safe.",
  });

/** Vista pública de un producto de la tienda (camelCase). */
export const ProductSchema = z
  .object({
    id: z.number().openapi({ example: 12, description: "Id numérico autogenerado." }),
    slug: SlugSchema,
    name: z.string().openapi({ example: "Invertir con Cabeza" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "Guía práctica de inversión.", description: "Descripción opcional." }),
    category: CategoryEnum.openapi({ example: "book" }),
    gender: GenderEnum.nullable().openapi({
      example: null,
      description: "Solo aplica a category='tshirt'.",
    }),
    theme: ThemeEnum.nullable().openapi({
      example: "dark",
      description: "Solo aplica a category='tshirt'.",
    }),
    price: z.number().nullable().openapi({ example: 29.99 }),
    currency: z.string().openapi({ example: "USD" }),
    amazonUrl: z
      .string()
      .url()
      .nullable()
      .openapi({ example: "https://amazon.com/dp/XXXX", description: "Enlace directo a Amazon." }),
    image: z.string().nullable().openapi({
      example: "store/ebooks/tmpjficd54i.webp",
      description: "Ruta relativa bajo assets/images/. La API no sirve el binario.",
    }),
    active: z.boolean().openapi({ example: true }),
    createdAt: z.string().openapi({ example: "2026-07-06T12:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-07-06T12:00:00.000Z" }),
  })
  .openapi("Product");

export const ProductsResponseSchema = z
  .object({ products: z.array(ProductSchema) })
  .openapi("ProductsResponse");

const ProductEnvelopeSchema = z.object({ product: ProductSchema }).openapi("ProductEnvelope");

// Objeto base SIN refine (necesario para poder derivar `.partial()` en Update).
// OJO: `currency`/`active` NO llevan `.default()` acá — Zod's `.partial()` NO limpia
// los defaults de un campo ya opcional (`.optional().default(x)` sigue reinyectando `x`
// cuando la clave está ausente incluso bajo `.partial()`). Si vivieran acá, un
// `PATCH {name: "x"}` resetearía `currency`/`active` en cada actualización parcial,
// violando el contrato "PATCH solo toca los campos enviados". Los defaults se aplican
// SOLO en `CreateProductSchema` (ver `.extend()` abajo), donde sí corresponden.
const ProductBodySchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).openapi({ example: "Invertir con Cabeza" }),
  description: z.string().nullable().optional().openapi({ example: null }),
  category: CategoryEnum,
  gender: GenderEnum.nullable().optional().openapi({ example: null }),
  theme: ThemeEnum.nullable().optional().openapi({ example: null }),
  price: z.number().positive().nullable().optional().openapi({ example: 29.99 }),
  currency: z.string().min(1).optional(),
  // Debe ser http(s): coincide con el CHECK `products_amazon_url_check` de la DB, así una
  // URL válida-pero-no-http (p. ej. ftp://) se rechaza acá con mensaje preciso en vez de
  // caer al mensaje genérico del CHECK violation.
  amazonUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//, "El enlace de Amazon debe ser una URL http(s).")
    .nullable()
    .optional()
    .openapi({ example: null }),
  image: z.string().nullable().optional().openapi({ example: "store/ebooks/x.webp" }),
  active: z.boolean().optional(),
});

const ATLEAST_ONE_MSG = "Definí un precio o un enlace de Amazon (al menos uno).";
const TYPED_VARIANT_MSG = "gender/theme solo aplican a la categoría 'tshirt'.";

export const CreateProductSchema = ProductBodySchema.extend({
  currency: z.string().min(1).optional().default("USD"),
  active: z.boolean().optional().default(true),
})
  .refine((data) => data.price != null || data.amazonUrl != null, {
    message: ATLEAST_ONE_MSG,
    path: ["price"],
  })
  .refine((data) => data.category === "tshirt" || (data.gender == null && data.theme == null), {
    message: TYPED_VARIANT_MSG,
    path: ["gender"],
  })
  .openapi("CreateProduct");

// PATCH parcial: los refines de Create no aplican tal cual (un patch que no toca price/amazonUrl
// es válido). Solo se rechaza el intento explícito de borrar AMBOS a la vez en el mismo patch;
// el caso "el patch deja la fila sin precio ni amazon" (por estado previo) lo cubre el CHECK de
// la DB vía `isCheckViolation` → 422 (ver products.service.ts, ADR-4).
export const UpdateProductSchema = ProductBodySchema.partial()
  .refine((patch) => !(patch.price === null && patch.amazonUrl === null), {
    message: "No podés borrar precio y enlace de Amazon a la vez: dejá al menos uno definido.",
    path: ["price"],
  })
  .refine(
    (patch) =>
      patch.category === undefined ||
      patch.category === "tshirt" ||
      ((patch.gender === undefined || patch.gender === null) &&
        (patch.theme === undefined || patch.theme === null)),
    { message: TYPED_VARIANT_MSG, path: ["gender"] },
  )
  .openapi("UpdateProduct");

export const ListProductsQuerySchema = z.object({
  category: CategoryEnum.optional().openapi({
    param: { name: "category", in: "query" },
    description: "Filtrar por categoría.",
  }),
  gender: GenderEnum.optional().openapi({
    param: { name: "gender", in: "query" },
    description: "Filtrar por género (solo aplica a tshirt).",
  }),
  theme: ThemeEnum.optional().openapi({
    param: { name: "theme", in: "query" },
    description: "Filtrar por tema claro/oscuro (solo aplica a tshirt).",
  }),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
    .openapi({
      param: { name: "active", in: "query" },
      description: "Filtrar por activo/inactivo. Omitido → catálogo completo.",
    }),
});

const IdOrSlugParamSchema = z.object({
  idOrSlug: z.string().openapi({
    param: { name: "idOrSlug", in: "path" },
    example: "libro-invertir-con-cabeza",
    description: "Id numérico o slug del producto.",
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
      description: "Id numérico del producto.",
    }),
});

// GET /tienda
export const listProductsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tienda"],
  summary: "Listar productos de la tienda",
  description:
    "Catálogo filtrable por categoría/gender/theme/active. Requiere usuario autenticado.",
  security: [{ bearerAuth: [] }],
  request: { query: ListProductsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ProductsResponseSchema } },
      description: "Productos.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});
export type ListProductsRoute = typeof listProductsRoute;

// GET /tienda/{idOrSlug}
export const getProductRoute = createRoute({
  method: "get",
  path: "/{idOrSlug}",
  tags: ["Tienda"],
  summary: "Obtener un producto",
  description:
    "Devuelve un producto por su id numérico o por su slug. Requiere usuario autenticado.",
  security: [{ bearerAuth: [] }],
  request: { params: IdOrSlugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: ProductEnvelopeSchema } },
      description: "Producto encontrado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    404: jsonErrorResponse("No existe un producto con ese id/slug (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});
export type GetProductRoute = typeof getProductRoute;

// POST /admin/tienda
export const createProductRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tienda", "Admin"],
  summary: "Crear un producto (admin)",
  description: "Alta en el catálogo. SOLO administradores (403 si no). Slug único.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateProductSchema } }, required: true },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ProductEnvelopeSchema } },
      description: "Producto creado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    409: jsonErrorResponse("Ya existe un producto con ese slug (`CONFLICT`)."),
    422: jsonErrorResponse(
      "Entrada inválida: falta price/amazonUrl o variante inválida (`VALIDATION_ERROR`).",
    ),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});
export type CreateProductRoute = typeof createProductRoute;

// PATCH /admin/tienda/{id}
export const updateProductRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Tienda", "Admin"],
  summary: "Actualizar un producto (admin)",
  description: "Actualización parcial. SOLO administradores (403 si no).",
  security: [{ bearerAuth: [] }],
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: UpdateProductSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ProductEnvelopeSchema } },
      description: "Producto actualizado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un producto con ese id (`NOT_FOUND`)."),
    409: jsonErrorResponse("El slug ya está en uso por otro producto (`CONFLICT`)."),
    422: jsonErrorResponse("Entrada inválida (`VALIDATION_ERROR`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});
export type UpdateProductRoute = typeof updateProductRoute;

// DELETE /admin/tienda/{id}
export const deleteProductRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Tienda", "Admin"],
  summary: "Eliminar un producto (admin)",
  description: "Baja del catálogo. SOLO administradores (403 si no).",
  security: [{ bearerAuth: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
      description: "Producto eliminado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token (`UNAUTHORIZED`)."),
    403: jsonErrorResponse("El usuario no es administrador (`FORBIDDEN`)."),
    404: jsonErrorResponse("No existe un producto con ese id (`NOT_FOUND`)."),
    503: jsonErrorResponse("Supabase no disponible (`SERVICE_UNAVAILABLE`)."),
  },
});
export type DeleteProductRoute = typeof deleteProductRoute;
