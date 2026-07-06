import { AppError } from "../../lib/errors";
import {
  isUniqueViolation,
  throwCheckViolationAs422,
  throwPostgrestError,
} from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { Database } from "../../types/database.types";

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

/** Categoría de producto (extensible vía CHECK en la DB). */
export type ProductCategory = "book" | "tshirt" | "cap";
/** Variante de género — solo aplica a category='tshirt'. */
export type ProductGender = "men" | "women";
/** Variante de tema claro/oscuro — solo aplica a category='tshirt'. */
export type ProductTheme = "light" | "dark";

/** Vista pública de un producto de la tienda (camelCase). */
export interface ProductView {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: ProductCategory;
  gender: ProductGender | null;
  theme: ProductTheme | null;
  price: number | null;
  currency: string;
  amazonUrl: string | null;
  image: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Datos para crear un producto. */
export interface NewProduct {
  slug: string;
  name: string;
  description?: string | null;
  category: ProductCategory;
  gender?: ProductGender | null;
  theme?: ProductTheme | null;
  price?: number | null;
  currency?: string;
  amazonUrl?: string | null;
  image?: string | null;
  active?: boolean;
}

/** Parche para actualizar un producto: todos los campos opcionales (PATCH parcial). */
export interface ProductPatch {
  slug?: string;
  name?: string;
  description?: string | null;
  category?: ProductCategory;
  gender?: ProductGender | null;
  theme?: ProductTheme | null;
  price?: number | null;
  currency?: string;
  amazonUrl?: string | null;
  image?: string | null;
  active?: boolean;
}

/** Filtros para listar el catálogo. */
export interface ProductFilters {
  category?: ProductCategory;
  gender?: ProductGender;
  theme?: ProductTheme;
  active?: boolean;
}

const PRODUCT_SELECT =
  "id, slug, name, description, category, gender, theme, price, currency, amazon_url, image, active, created_at, updated_at";

/** Forma cruda de la fila (snake_case de PostgREST). */
interface ProductQueryRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  gender: string | null;
  theme: string | null;
  // PostgREST serializa `numeric` como STRING JSON (p. ej. "29.99"); se convierte en el
  // mapper (mismo motivo que Number(...) en operations/capital repositories).
  price: string | null;
  currency: string;
  amazon_url: string | null;
  image: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Mapper único snake_case → camelCase, reutilizado por list/get/create/update (DRY). */
function toProductView(row: ProductQueryRow): ProductView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category as ProductCategory,
    gender: row.gender as ProductGender | null,
    theme: row.theme as ProductTheme | null,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    amazonUrl: row.amazon_url,
    image: row.image,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Traduce un input camelCase al payload snake_case de insert. */
function toProductInsertPayload(input: NewProduct) {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    category: input.category,
    gender: input.gender ?? null,
    theme: input.theme ?? null,
    price: input.price ?? null,
    currency: input.currency ?? "USD",
    amazon_url: input.amazonUrl ?? null,
    image: input.image ?? null,
    active: input.active ?? true,
  };
}

/**
 * Traduce un parche camelCase al payload snake_case de la tabla, incluyendo SOLO las
 * claves presentes (un `undefined` = "no tocar"; un `null` explícito = "limpiar el campo").
 */
function toProductUpdatePayload(patch: ProductPatch): ProductUpdate {
  return {
    ...(patch.slug !== undefined && { slug: patch.slug }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.category !== undefined && { category: patch.category }),
    ...(patch.gender !== undefined && { gender: patch.gender }),
    ...(patch.theme !== undefined && { theme: patch.theme }),
    ...(patch.price !== undefined && { price: patch.price }),
    ...(patch.currency !== undefined && { currency: patch.currency }),
    ...(patch.amazonUrl !== undefined && { amazon_url: patch.amazonUrl }),
    ...(patch.image !== undefined && { image: patch.image }),
    ...(patch.active !== undefined && { active: patch.active }),
  };
}

const CHECK_VIOLATION_MESSAGE =
  "Definí precio o enlace de Amazon (al menos uno); gender/theme solo aplican a tshirt.";

/** Lista el catálogo, filtrado condicionalmente por category/gender/theme/active. */
export async function listProducts(
  admin: AppSupabaseClient,
  filters: ProductFilters,
): Promise<{ products: ProductView[] }> {
  let query = admin.from("products").select(PRODUCT_SELECT);
  if (filters.category !== undefined) query = query.eq("category", filters.category);
  if (filters.gender !== undefined) query = query.eq("gender", filters.gender);
  if (filters.theme !== undefined) query = query.eq("theme", filters.theme);
  if (filters.active !== undefined) query = query.eq("active", filters.active);

  const { data, error, status } = await query
    .order("category")
    .order("name")
    .returns<ProductQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los productos.", status);
  return { products: (data ?? []).map(toProductView) };
}

/** Busca un producto por una columna concreta (`id` o `slug`); `null` si no hay match. */
async function findProductBy(
  admin: AppSupabaseClient,
  column: "id" | "slug",
  value: number | string,
): Promise<ProductView | null> {
  const { data, error, status } = await admin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq(column, value)
    .limit(1)
    .returns<ProductQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudo leer el producto.", status);
  const row = data?.[0];
  return row ? toProductView(row) : null;
}

/**
 * Devuelve un producto por id numérico o por slug; `null` si no existe. El slug admite
 * dígitos (`^[a-z0-9_-]+$`), así que un valor numérico es ambiguo: se prueba primero por
 * `id` (intención más común de un path param numérico) y, si no hay match, por `slug`.
 */
export async function getProduct(
  admin: AppSupabaseClient,
  idOrSlug: string,
): Promise<ProductView | null> {
  if (/^\d+$/.test(idOrSlug)) {
    const byId = await findProductBy(admin, "id", Number(idOrSlug));
    return byId ?? findProductBy(admin, "slug", idOrSlug);
  }
  return findProductBy(admin, "slug", idOrSlug);
}

/** Crea un producto. Slug duplicado → `CONFLICT` (409); CHECK violation → 422 (defense-in-depth). */
export async function createProduct(
  admin: AppSupabaseClient,
  input: NewProduct,
): Promise<ProductView> {
  const { data, error, status } = await admin
    .from("products")
    .insert(toProductInsertPayload(input))
    .select(PRODUCT_SELECT)
    .single<ProductQueryRow>();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un producto con ese slug.", 409);
    }
    throwCheckViolationAs422(
      error,
      CHECK_VIOLATION_MESSAGE,
      "No se pudo crear el producto.",
      status,
    );
  }
  return toProductView(data);
}

/**
 * Actualiza un producto. `NOT_FOUND` (404) si no existe; slug duplicado → `CONFLICT` (409);
 * CHECK violation resultante → 422 (defense-in-depth, ver ADR-4 de design.md).
 */
export async function updateProduct(
  admin: AppSupabaseClient,
  id: number,
  patch: ProductPatch,
): Promise<ProductView> {
  const payload = toProductUpdatePayload(patch);
  // PATCH sin campos: no hay nada que escribir → devolvemos el estado actual (o 404).
  if (Object.keys(payload).length === 0) {
    const current = await getProduct(admin, String(id));
    if (!current) throw new AppError("NOT_FOUND", "Producto no encontrado.", 404);
    return current;
  }

  const { data, error, status } = await admin
    .from("products")
    .update(payload)
    .eq("id", id)
    .select(PRODUCT_SELECT)
    .returns<ProductQueryRow[]>();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un producto con ese slug.", 409);
    }
    throwCheckViolationAs422(
      error,
      CHECK_VIOLATION_MESSAGE,
      "No se pudo actualizar el producto.",
      status,
    );
  }
  const row = data?.[0];
  if (!row) throw new AppError("NOT_FOUND", "Producto no encontrado.", 404);
  return toProductView(row);
}

/** Elimina un producto. `NOT_FOUND` (404) si no existía. */
export async function deleteProduct(admin: AppSupabaseClient, id: number): Promise<void> {
  const { data, error, status } = await admin.from("products").delete().eq("id", id).select("id");
  if (error) throwPostgrestError(error, "No se pudo borrar el producto.", status);
  if ((data?.length ?? 0) === 0) throw new AppError("NOT_FOUND", "Producto no encontrado.", 404);
}
