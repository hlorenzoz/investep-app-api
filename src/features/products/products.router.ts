import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import {
  createProductHandler,
  deleteProductHandler,
  getProductHandler,
  listProductsHandler,
  updateProductHandler,
} from "./products.handlers";
import {
  createProductRoute,
  deleteProductRoute,
  getProductRoute,
  listProductsRoute,
  updateProductRoute,
} from "./products.routes";

/**
 * Router CLIENTE de la tienda: lectura del catálogo para cualquier usuario autenticado.
 * Monta en `/tienda` (GET lista+filtros + GET por id/slug).
 */
export const productsRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
productsRouter.use("*", requireAuth);
productsRouter.openapi(listProductsRoute, listProductsHandler);
productsRouter.openapi(getProductRoute, getProductHandler);

/**
 * Router ADMIN de la tienda: mutaciones del catálogo. Monta en `/admin/tienda`.
 * `requireAuth` + `requireAdmin`: un no-admin recibe 403 (el gate vive acá porque los
 * handlers usan el service-role client, que bypassa RLS).
 */
export const adminProductsRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
adminProductsRouter.use("*", requireAuth);
adminProductsRouter.use("*", requireAdmin);
adminProductsRouter
  .openapi(createProductRoute, createProductHandler)
  .openapi(updateProductRoute, updateProductHandler)
  .openapi(deleteProductRoute, deleteProductHandler);
