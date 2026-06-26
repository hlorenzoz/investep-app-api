import { AppError } from "../../lib/errors";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  throwPostgrestError,
} from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { Database } from "../../types/database.types";

type BrokerUpdate = Database["public"]["Tables"]["brokers"]["Update"];

/**
 * Vista pública de un broker del catálogo (camelCase). Es la forma que consume el
 * frontend en el paso "Elegí tu broker" del setup. Omite timestamps a propósito:
 * el cliente no los necesita y mantienen el payload chico.
 */
export interface BrokerView {
  id: number;
  slug: string;
  name: string;
  url: string;
  urlSecondary: string | null;
  logo: string | null;
  favicon: string | null;
  icon: string | null;
}

/** Datos para crear un broker (las imágenes y el dominio secundario son opcionales). */
export interface NewBroker {
  slug: string;
  name: string;
  url: string;
  urlSecondary?: string | null;
  logo?: string | null;
  favicon?: string | null;
  icon?: string | null;
}

/** Parche para actualizar un broker: todos los campos opcionales (PATCH parcial). */
export interface BrokerPatch {
  slug?: string;
  name?: string;
  url?: string;
  urlSecondary?: string | null;
  logo?: string | null;
  favicon?: string | null;
  icon?: string | null;
}

const BROKER_SELECT = "id, slug, name, url, url_secondary, logo, favicon, icon";

/** Forma cruda de la fila (snake_case de PostgREST). */
interface BrokerQueryRow {
  id: number;
  slug: string;
  name: string;
  url: string;
  url_secondary: string | null;
  logo: string | null;
  favicon: string | null;
  icon: string | null;
}

/** Mapper único snake_case → camelCase, reutilizado por list/get/create/update (DRY). */
function toBrokerView(row: BrokerQueryRow): BrokerView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    url: row.url,
    urlSecondary: row.url_secondary,
    logo: row.logo,
    favicon: row.favicon,
    icon: row.icon,
  };
}

/**
 * Traduce un parche camelCase al payload snake_case de la tabla, incluyendo SOLO las
 * claves presentes (un `undefined` = "no tocar"; un `null` explícito = "limpiar el campo").
 */
function toBrokerUpdatePayload(patch: BrokerPatch): BrokerUpdate {
  return {
    ...(patch.slug !== undefined && { slug: patch.slug }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.url !== undefined && { url: patch.url }),
    ...(patch.urlSecondary !== undefined && { url_secondary: patch.urlSecondary }),
    ...(patch.logo !== undefined && { logo: patch.logo }),
    ...(patch.favicon !== undefined && { favicon: patch.favicon }),
    ...(patch.icon !== undefined && { icon: patch.icon }),
  };
}

/** Lista el catálogo completo de brokers, ordenado por nombre (un solo round-trip). */
export async function listBrokers(admin: AppSupabaseClient): Promise<{ brokers: BrokerView[] }> {
  const { data, error, status } = await admin
    .from("brokers")
    .select(BROKER_SELECT)
    .order("name")
    .returns<BrokerQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los brokers.", status);
  return { brokers: (data ?? []).map(toBrokerView) };
}

/** Busca un broker por una columna concreta (`id` o `slug`); `null` si no hay match. */
async function findBrokerBy(
  admin: AppSupabaseClient,
  column: "id" | "slug",
  value: number | string,
): Promise<BrokerView | null> {
  const { data, error, status } = await admin
    .from("brokers")
    .select(BROKER_SELECT)
    .eq(column, value)
    .limit(1)
    .returns<BrokerQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudo leer el broker.", status);
  const row = data?.[0];
  return row ? toBrokerView(row) : null;
}

/**
 * Devuelve un broker por id numérico o por slug; `null` si no existe. El slug admite
 * dígitos (`^[a-z0-9_-]+$`), así que un valor numérico es ambiguo: se prueba primero por
 * `id` (intención más común de un path param numérico) y, si no hay match, por `slug`.
 */
export async function getBroker(
  admin: AppSupabaseClient,
  idOrSlug: string,
): Promise<BrokerView | null> {
  if (/^\d+$/.test(idOrSlug)) {
    const byId = await findBrokerBy(admin, "id", Number(idOrSlug));
    return byId ?? findBrokerBy(admin, "slug", idOrSlug);
  }
  return findBrokerBy(admin, "slug", idOrSlug);
}

/** Crea un broker. Slug duplicado → `CONFLICT` (409). */
export async function createBroker(
  admin: AppSupabaseClient,
  input: NewBroker,
): Promise<BrokerView> {
  const { data, error, status } = await admin
    .from("brokers")
    .insert({
      slug: input.slug,
      name: input.name,
      url: input.url,
      url_secondary: input.urlSecondary ?? null,
      logo: input.logo ?? null,
      favicon: input.favicon ?? null,
      icon: input.icon ?? null,
    })
    .select(BROKER_SELECT)
    .single<BrokerQueryRow>();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un broker con ese slug.", 409);
    }
    throwPostgrestError(error, "No se pudo crear el broker.", status);
  }
  return toBrokerView(data);
}

/** Actualiza un broker. `NOT_FOUND` (404) si no existe; slug duplicado → `CONFLICT` (409). */
export async function updateBroker(
  admin: AppSupabaseClient,
  id: number,
  patch: BrokerPatch,
): Promise<BrokerView> {
  const payload = toBrokerUpdatePayload(patch);
  // PATCH sin campos: no hay nada que escribir → devolvemos el estado actual (o 404).
  if (Object.keys(payload).length === 0) {
    const current = await getBroker(admin, String(id));
    if (!current) throw new AppError("NOT_FOUND", "Broker no encontrado.", 404);
    return current;
  }

  const { data, error, status } = await admin
    .from("brokers")
    .update(payload)
    .eq("id", id)
    .select(BROKER_SELECT)
    .returns<BrokerQueryRow[]>();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un broker con ese slug.", 409);
    }
    throwPostgrestError(error, "No se pudo actualizar el broker.", status);
  }
  const row = data?.[0];
  if (!row) throw new AppError("NOT_FOUND", "Broker no encontrado.", 404);
  return toBrokerView(row);
}

/** Elimina un broker. `NOT_FOUND` (404) si no existía. */
export async function deleteBroker(admin: AppSupabaseClient, id: number): Promise<void> {
  const { data, error, status } = await admin.from("brokers").delete().eq("id", id).select("id");
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "No se puede borrar: el broker está referenciado por asignaciones.",
        409,
      );
    }
    throwPostgrestError(error, "No se pudo borrar el broker.", status);
  }
  if ((data?.length ?? 0) === 0) throw new AppError("NOT_FOUND", "Broker no encontrado.", 404);
}
