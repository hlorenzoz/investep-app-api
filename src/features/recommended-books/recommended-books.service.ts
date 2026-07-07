import { AppError } from "../../lib/errors";
import {
  isUniqueViolation,
  throwCheckViolationAs422,
  throwPostgrestError,
} from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { Database } from "../../types/database.types";

type RecommendedBookUpdate = Database["public"]["Tables"]["recommended_books"]["Update"];

/**
 * Mensaje de un CHECK violado en la DB (defense in depth) → 422, no un 500 genérico. La
 * tabla tiene dos CHECK de input: `slug ~ '^[a-z0-9_-]+$'` y `url ~ '^https?://'`. Hoy el
 * único alcanzable vía API es la URL (Zod valida `.url()`, que admite ftp/mailto, mientras
 * el slug ya se valida con el mismo regex que la DB); el mensaje nombra ambos para no
 * inducir a error si un cambio futuro abre el otro camino.
 */
const CHECK_VIOLATION_MESSAGE =
  "Datos inválidos: revisá el slug (minúsculas, números, guiones) y la URL (http(s)).";

/**
 * Vista pública de un libro recomendado (camelCase). Omite timestamps a propósito:
 * el cliente no los necesita y mantienen el payload chico.
 */
export interface RecommendedBookView {
  id: number;
  slug: string;
  title: string;
  author: string;
  description: string;
  url: string;
  image: string;
  sortOrder: number;
}

/** Datos para crear un libro recomendado (`sortOrder` opcional, default 0 en la tabla). */
export interface NewRecommendedBook {
  slug: string;
  title: string;
  author: string;
  description: string;
  url: string;
  image: string;
  sortOrder?: number;
}

/** Parche para actualizar un libro: todos los campos opcionales (PATCH parcial). */
export interface RecommendedBookPatch {
  slug?: string;
  title?: string;
  author?: string;
  description?: string;
  url?: string;
  image?: string;
  sortOrder?: number;
}

const BOOK_SELECT = "id, slug, title, author, description, url, image, sort_order";

/** Forma cruda de la fila (snake_case de PostgREST). */
interface RecommendedBookQueryRow {
  id: number;
  slug: string;
  title: string;
  author: string;
  description: string;
  url: string;
  image: string;
  sort_order: number;
}

/** Mapper único snake_case → camelCase, reutilizado por list/get/create/update (DRY). */
function toRecommendedBookView(row: RecommendedBookQueryRow): RecommendedBookView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    description: row.description,
    url: row.url,
    image: row.image,
    sortOrder: row.sort_order,
  };
}

/**
 * Traduce un parche camelCase al payload snake_case de la tabla, incluyendo SOLO las
 * claves presentes (un `undefined` = "no tocar").
 */
function toRecommendedBookUpdatePayload(patch: RecommendedBookPatch): RecommendedBookUpdate {
  return {
    ...(patch.slug !== undefined && { slug: patch.slug }),
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.author !== undefined && { author: patch.author }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.url !== undefined && { url: patch.url }),
    ...(patch.image !== undefined && { image: patch.image }),
    ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
  };
}

/**
 * Lista los libros recomendados en el orden editorial (`sort_order` asc, `id` como
 * desempate estable) — NO alfabético: la página curada define la posición de cada libro.
 */
export async function listRecommendedBooks(
  admin: AppSupabaseClient,
): Promise<{ recommendedBooks: RecommendedBookView[] }> {
  const { data, error, status } = await admin
    .from("recommended_books")
    .select(BOOK_SELECT)
    .order("sort_order")
    .order("id")
    .returns<RecommendedBookQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los libros recomendados.", status);
  return { recommendedBooks: (data ?? []).map(toRecommendedBookView) };
}

/** Busca un libro por una columna concreta (`id` o `slug`); `null` si no hay match. */
async function findRecommendedBookBy(
  admin: AppSupabaseClient,
  column: "id" | "slug",
  value: number | string,
): Promise<RecommendedBookView | null> {
  const { data, error, status } = await admin
    .from("recommended_books")
    .select(BOOK_SELECT)
    .eq(column, value)
    .limit(1)
    .returns<RecommendedBookQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudo leer el libro recomendado.", status);
  const row = data?.[0];
  return row ? toRecommendedBookView(row) : null;
}

/**
 * Devuelve un libro por id numérico o por slug; `null` si no existe. El slug admite
 * dígitos (`^[a-z0-9_-]+$`), así que un valor numérico es ambiguo: se prueba primero por
 * `id` (intención más común de un path param numérico) y, si no hay match, por `slug`.
 */
export async function getRecommendedBook(
  admin: AppSupabaseClient,
  idOrSlug: string,
): Promise<RecommendedBookView | null> {
  if (/^\d+$/.test(idOrSlug)) {
    const byId = await findRecommendedBookBy(admin, "id", Number(idOrSlug));
    return byId ?? findRecommendedBookBy(admin, "slug", idOrSlug);
  }
  return findRecommendedBookBy(admin, "slug", idOrSlug);
}

/** Crea un libro recomendado. Slug duplicado → `CONFLICT` (409). */
export async function createRecommendedBook(
  admin: AppSupabaseClient,
  input: NewRecommendedBook,
): Promise<RecommendedBookView> {
  const { data, error, status } = await admin
    .from("recommended_books")
    .insert({
      slug: input.slug,
      title: input.title,
      author: input.author,
      description: input.description,
      url: input.url,
      image: input.image,
      ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
    })
    .select(BOOK_SELECT)
    .single<RecommendedBookQueryRow>();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un libro con ese slug.", 409);
    }
    throwCheckViolationAs422(
      error,
      CHECK_VIOLATION_MESSAGE,
      "No se pudo crear el libro recomendado.",
      status,
    );
  }
  return toRecommendedBookView(data);
}

/** Actualiza un libro. `NOT_FOUND` (404) si no existe; slug duplicado → `CONFLICT` (409). */
export async function updateRecommendedBook(
  admin: AppSupabaseClient,
  id: number,
  patch: RecommendedBookPatch,
): Promise<RecommendedBookView> {
  const payload = toRecommendedBookUpdatePayload(patch);
  // PATCH sin campos: no hay nada que escribir → devolvemos el estado actual (o 404).
  if (Object.keys(payload).length === 0) {
    const current = await getRecommendedBook(admin, String(id));
    if (!current) throw new AppError("NOT_FOUND", "Libro recomendado no encontrado.", 404);
    return current;
  }

  const { data, error, status } = await admin
    .from("recommended_books")
    .update(payload)
    .eq("id", id)
    .select(BOOK_SELECT)
    .returns<RecommendedBookQueryRow[]>();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un libro con ese slug.", 409);
    }
    throwCheckViolationAs422(
      error,
      CHECK_VIOLATION_MESSAGE,
      "No se pudo actualizar el libro recomendado.",
      status,
    );
  }
  const row = data?.[0];
  if (!row) throw new AppError("NOT_FOUND", "Libro recomendado no encontrado.", 404);
  return toRecommendedBookView(row);
}

/** Elimina un libro. `NOT_FOUND` (404) si no existía. */
export async function deleteRecommendedBook(admin: AppSupabaseClient, id: number): Promise<void> {
  const { data, error, status } = await admin
    .from("recommended_books")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throwPostgrestError(error, "No se pudo borrar el libro recomendado.", status);
  if ((data?.length ?? 0) === 0) {
    throw new AppError("NOT_FOUND", "Libro recomendado no encontrado.", 404);
  }
}
