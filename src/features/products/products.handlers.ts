import type { RouteHandler } from "@hono/zod-openapi";
import { AppError } from "../../lib/errors";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreateProductRoute,
  DeleteProductRoute,
  GetProductRoute,
  ListProductsRoute,
  UpdateProductRoute,
} from "./products.routes";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "./products.service";

// El gate de autorización (`requireAdmin`) vive en el router; estos handlers asumen
// que ya pasó. Cada uno arma el admin client (service-role, bypassa RLS) por request
// — sin estado en módulo (Workers, §3).

/** GET /tienda — lista el catálogo, filtrado condicionalmente por category/gender/theme/active. */
export const listProductsHandler: RouteHandler<ListProductsRoute, AuthedBindings> = async (c) => {
  const filters = c.req.valid("query");
  const result = await listProducts(createSupabaseAdminClient(c.env), filters);
  return c.json(result, 200);
};

/** GET /tienda/:idOrSlug — devuelve un producto por id o slug; 404 si no existe. */
export const getProductHandler: RouteHandler<GetProductRoute, AuthedBindings> = async (c) => {
  const { idOrSlug } = c.req.valid("param");
  const product = await getProduct(createSupabaseAdminClient(c.env), idOrSlug);
  if (!product) throw new AppError("NOT_FOUND", "Producto no encontrado.", 404);
  return c.json({ product }, 200);
};

/** POST /admin/tienda — crea un producto (admin-only). Responde 201 con el producto creado. */
export const createProductHandler: RouteHandler<CreateProductRoute, AuthedBindings> = async (c) => {
  const input = c.req.valid("json");
  const product = await createProduct(createSupabaseAdminClient(c.env), input);
  return c.json({ product }, 201);
};

/** PATCH /admin/tienda/:id — actualiza campos de un producto (admin-only). */
export const updateProductHandler: RouteHandler<UpdateProductRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const product = await updateProduct(createSupabaseAdminClient(c.env), id, patch);
  return c.json({ product }, 200);
};

/** DELETE /admin/tienda/:id — elimina un producto (admin-only). */
export const deleteProductHandler: RouteHandler<DeleteProductRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  await deleteProduct(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
