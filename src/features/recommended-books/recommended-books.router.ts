import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import { createRateLimitMiddleware } from "../../middleware/rate-limit";
import type { AuthedBindings } from "../../types/app";
import {
  createRecommendedBookHandler,
  deleteRecommendedBookHandler,
  getRecommendedBookHandler,
  listRecommendedBooksHandler,
  updateRecommendedBookHandler,
} from "./recommended-books.handlers";
import {
  createRecommendedBookRoute,
  deleteRecommendedBookRoute,
  getRecommendedBookRoute,
  listRecommendedBooksRoute,
  updateRecommendedBookRoute,
} from "./recommended-books.routes";

/**
 * Router CLIENTE de libros recomendados: lectura de la lista curada para cualquier
 * usuario autenticado. Monta en `/recommended-books` (GET lista + GET por id/slug).
 */
export const recommendedBooksRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
recommendedBooksRouter.use("*", requireAuth);
recommendedBooksRouter.openapi(listRecommendedBooksRoute, listRecommendedBooksHandler);
recommendedBooksRouter.openapi(getRecommendedBookRoute, getRecommendedBookHandler);

/**
 * Router ADMIN de libros recomendados: mutaciones de la lista. Monta en
 * `/admin/recommended-books`. Rate limit (solo mutaciones) + `requireAuth` + `requireAdmin`:
 * un no-admin recibe 403 (el gate vive acá porque los handlers usan el service-role
 * client, que bypassa RLS).
 */
export const adminRecommendedBooksRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});
adminRecommendedBooksRouter.use(
  "*",
  createRateLimitMiddleware({
    name: "ADMIN_WRITE_RATE_LIMITER",
    getLimiter: (env) => env.ADMIN_WRITE_RATE_LIMITER,
    methods: ["POST", "PATCH", "PUT", "DELETE"],
  }),
);
adminRecommendedBooksRouter.use("*", requireAuth);
adminRecommendedBooksRouter.use("*", requireAdmin);
adminRecommendedBooksRouter
  .openapi(createRecommendedBookRoute, createRecommendedBookHandler)
  .openapi(updateRecommendedBookRoute, updateRecommendedBookHandler)
  .openapi(deleteRecommendedBookRoute, deleteRecommendedBookHandler);
