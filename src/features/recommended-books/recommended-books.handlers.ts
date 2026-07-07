import type { RouteHandler } from "@hono/zod-openapi";
import { AppError } from "../../lib/errors";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreateRecommendedBookRoute,
  DeleteRecommendedBookRoute,
  GetRecommendedBookRoute,
  ListRecommendedBooksRoute,
  UpdateRecommendedBookRoute,
} from "./recommended-books.routes";
import {
  createRecommendedBook,
  deleteRecommendedBook,
  getRecommendedBook,
  listRecommendedBooks,
  updateRecommendedBook,
} from "./recommended-books.service";

// El gate de autorización (`requireAdmin`) vive en el router; estos handlers asumen
// que ya pasó. Cada uno arma el admin client (service-role, bypassa RLS) por request
// — sin estado en módulo (Workers, §3).

/** GET /recommended-books — lista la selección curada en orden editorial. */
export const listRecommendedBooksHandler: RouteHandler<
  ListRecommendedBooksRoute,
  AuthedBindings
> = async (c) => {
  const result = await listRecommendedBooks(createSupabaseAdminClient(c.env));
  return c.json(result, 200);
};

/** GET /recommended-books/:idOrSlug — devuelve un libro por id o slug; 404 si no existe. */
export const getRecommendedBookHandler: RouteHandler<
  GetRecommendedBookRoute,
  AuthedBindings
> = async (c) => {
  const { idOrSlug } = c.req.valid("param");
  const recommendedBook = await getRecommendedBook(createSupabaseAdminClient(c.env), idOrSlug);
  if (!recommendedBook) throw new AppError("NOT_FOUND", "Libro recomendado no encontrado.", 404);
  return c.json({ recommendedBook }, 200);
};

/** POST /admin/recommended-books — crea un libro (admin-only). Responde 201 con el creado. */
export const createRecommendedBookHandler: RouteHandler<
  CreateRecommendedBookRoute,
  AuthedBindings
> = async (c) => {
  const input = c.req.valid("json");
  const recommendedBook = await createRecommendedBook(createSupabaseAdminClient(c.env), input);
  return c.json({ recommendedBook }, 201);
};

/** PATCH /admin/recommended-books/:id — actualiza campos de un libro (admin-only). */
export const updateRecommendedBookHandler: RouteHandler<
  UpdateRecommendedBookRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const recommendedBook = await updateRecommendedBook(createSupabaseAdminClient(c.env), id, patch);
  return c.json({ recommendedBook }, 200);
};

/** DELETE /admin/recommended-books/:id — elimina un libro (admin-only). */
export const deleteRecommendedBookHandler: RouteHandler<
  DeleteRecommendedBookRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  await deleteRecommendedBook(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
