import { AppError } from "../../lib/errors";
import { logError } from "../../lib/log";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  throwForeignKeyAs422,
  throwPostgrestError,
} from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";

export const DEFAULT_LOCALE = "es";

// ---------------------------------------------------------------------------
// Vista CLIENTE (GET /academy/plans): textos del locale pedido + matriz de features.
// ---------------------------------------------------------------------------

export interface AcademyFeatureView {
  id: number;
  slug: string;
  label: string | null;
}

export interface AcademyPlanView {
  id: number;
  slug: string;
  name: string | null;
  subtitle: string | null;
  priceRegular: number;
  priceOffer: number | null;
  currency: string;
  features: AcademyFeatureView[];
}

export interface ListAcademyPlansOptions {
  locale?: string;
}

/** Forma cruda (PostgREST) de la lista cliente: embebe traducciones del plan y la matriz de features. */
interface AcademyPlanClientRow {
  id: number;
  slug: string;
  // PostgREST devuelve numeric como string; coercemos al mapear.
  price_regular: number | string;
  price_offer: number | string | null;
  currency: string;
  sort_order: number;
  investep_plan_translations: { locale: string; name: string; subtitle: string | null }[] | null;
  investep_plan_features:
    | {
        investep_features: {
          id: number;
          slug: string;
          sort_order: number;
          investep_feature_translations: { locale: string; label: string }[] | null;
        } | null;
      }[]
    | null;
}

const CLIENT_SELECT =
  "id, slug, price_regular, price_offer, currency, sort_order, " +
  "investep_plan_translations(locale, name, subtitle), " +
  "investep_plan_features(investep_features(id, slug, sort_order, investep_feature_translations(locale, label)))";

/**
 * Lista los paquetes ACTIVOS con sus textos del locale pedido (default `es`) y la matriz de
 * features. Un solo round-trip: traducciones y features van embebidas; se elige el locale y
 * se ordenan las features (por `sort_order`) en memoria. Sin traducción para el locale → `null`.
 */
export async function listAcademyPlans(
  admin: AppSupabaseClient,
  options: ListAcademyPlansOptions = {},
): Promise<{ locale: string; plans: AcademyPlanView[] }> {
  const locale = options.locale ?? DEFAULT_LOCALE;

  const { data, error, status } = await admin
    .from("investep_plans")
    .select(CLIENT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .returns<AcademyPlanClientRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los paquetes.", status);

  const plans: AcademyPlanView[] = (data ?? []).map((row) => {
    const tr = row.investep_plan_translations?.find((t) => t.locale === locale);
    const features: AcademyFeatureView[] = (row.investep_plan_features ?? [])
      .map((pf) => pf.investep_features)
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({
        id: f.id,
        slug: f.slug,
        label: f.investep_feature_translations?.find((t) => t.locale === locale)?.label ?? null,
      }));

    return {
      id: row.id,
      slug: row.slug,
      name: tr?.name ?? null,
      subtitle: tr?.subtitle ?? null,
      priceRegular: Number(row.price_regular),
      priceOffer: row.price_offer == null ? null : Number(row.price_offer),
      currency: row.currency,
      features,
    };
  });

  return { locale, plans };
}

// ---------------------------------------------------------------------------
// Administración (admin-only). El gate de authz vive en el router (`requireAdmin`);
// estas funciones operan con el service-role client, que bypassa RLS.
// ---------------------------------------------------------------------------

export interface AcademyPlanTranslation {
  locale: string;
  name: string;
  subtitle: string | null;
}

export interface AcademyPlanAdminView {
  id: number;
  slug: string;
  priceRegular: number;
  priceOffer: number | null;
  currency: string;
  sortOrder: number;
  isActive: boolean;
  translations: AcademyPlanTranslation[];
  featureIds: number[];
}

/** Datos para crear un paquete: `slug` único, al menos una traducción, ids de features (puede ir vacío). */
export interface NewAcademyPlan {
  slug: string;
  priceRegular: number;
  priceOffer?: number | null;
  currency?: string;
  sortOrder?: number;
  isActive?: boolean;
  translations: AcademyPlanTranslation[];
  featureIds: number[];
}

/** Parche parcial. `slug` NO se incluye a propósito: es el identificador estable, no editable. */
export interface AcademyPlanPatch {
  priceRegular?: number;
  priceOffer?: number | null;
  currency?: string;
  sortOrder?: number;
  isActive?: boolean;
  translations?: AcademyPlanTranslation[];
  featureIds?: number[];
}

const ADMIN_SELECT =
  "id, slug, price_regular, price_offer, currency, sort_order, is_active, " +
  "investep_plan_translations(locale, name, subtitle), " +
  "investep_plan_features(investep_feature_id)";

interface AcademyPlanAdminRow {
  id: number;
  slug: string;
  price_regular: number | string;
  price_offer: number | string | null;
  currency: string;
  sort_order: number;
  is_active: boolean;
  investep_plan_translations: { locale: string; name: string; subtitle: string | null }[] | null;
  investep_plan_features: { investep_feature_id: number }[] | null;
}

/** Mapper único de la fila admin → vista admin (DRY: list/get/update lo reutilizan). */
function toAdminView(row: AcademyPlanAdminRow): AcademyPlanAdminView {
  return {
    id: row.id,
    slug: row.slug,
    priceRegular: Number(row.price_regular),
    priceOffer: row.price_offer == null ? null : Number(row.price_offer),
    currency: row.currency,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    translations: (row.investep_plan_translations ?? []).map((t) => ({
      locale: t.locale,
      name: t.name,
      subtitle: t.subtitle,
    })),
    featureIds: (row.investep_plan_features ?? []).map((pf) => pf.investep_feature_id),
  };
}

// Mensajes de error del dominio (reutilizados en create/update con throwForeignKeyAs422).
const TRANSLATION_LOCALE_INVALID = "Una de las traducciones usa un locale desconocido.";
const TRANSLATION_SAVE_FAILED = "No se pudieron guardar las traducciones del paquete.";
const FEATURE_INVALID = "Una de las features no existe.";
const FEATURE_SAVE_FAILED = "No se pudieron asociar las features del paquete.";

/** Lista TODOS los paquetes (activos e inactivos) con traducciones e ids de features. */
export async function listAcademyPlansAdmin(
  admin: AppSupabaseClient,
): Promise<{ plans: AcademyPlanAdminView[] }> {
  const { data, error, status } = await admin
    .from("investep_plans")
    .select(ADMIN_SELECT)
    .order("sort_order")
    .returns<AcademyPlanAdminRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los paquetes.", status);
  return { plans: (data ?? []).map(toAdminView) };
}

/** Devuelve un paquete con sus traducciones e ids de features (un round-trip); `null` si no existe. */
export async function getAcademyPlanDetail(
  admin: AppSupabaseClient,
  id: number,
): Promise<AcademyPlanAdminView | null> {
  const { data, error, status } = await admin
    .from("investep_plans")
    .select(ADMIN_SELECT)
    .eq("id", id)
    .limit(1)
    .returns<AcademyPlanAdminRow[]>();
  if (error) throwPostgrestError(error, "No se pudo leer el paquete.", status);
  const row = data?.[0];
  return row ? toAdminView(row) : null;
}

/**
 * Crea un paquete con sus traducciones y features. `slug` duplicado → `CONFLICT` (409).
 * PostgREST no es transaccional entre tablas: si traducciones o features fallan tras crear el
 * plan, se borra el plan (rollback best-effort; el cascade limpia lo ya insertado) y se propaga.
 */
export async function createAcademyPlan(
  admin: AppSupabaseClient,
  input: NewAcademyPlan,
): Promise<AcademyPlanAdminView> {
  const { data, error, status } = await admin
    .from("investep_plans")
    .insert({
      slug: input.slug,
      price_regular: input.priceRegular,
      price_offer: input.priceOffer ?? null,
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    })
    .select("id, slug, price_regular, price_offer, currency, sort_order, is_active")
    .single<{
      id: number;
      slug: string;
      price_regular: number | string;
      price_offer: number | string | null;
      currency: string;
      sort_order: number;
      is_active: boolean;
    }>();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un paquete con ese slug.", 409);
    }
    throwPostgrestError(error, "No se pudo crear el paquete.", status);
  }

  // Capturamos el id: el narrowing de TS sobre `data` no cruza las funciones anidadas de abajo
  // (closure de rollback + callbacks de .map()).
  const planId = data.id;

  // Best-effort rollback del plan recién creado (cascade limpia traducciones/features ya insertadas).
  async function rollback(): Promise<void> {
    const { error: rollbackErr } = await admin.from("investep_plans").delete().eq("id", planId);
    if (rollbackErr) {
      // Evento estructurado (§12): un paquete a medio crear es justo lo que querés rastrear.
      logError("academy_plan_rollback_failed", { planId });
    }
  }

  const { error: tErr, status: tStatus } = await admin.from("investep_plan_translations").insert(
    input.translations.map((t) => ({
      investep_plan_id: planId,
      locale: t.locale,
      name: t.name,
      subtitle: t.subtitle,
    })),
  );
  if (tErr) {
    await rollback();
    throwForeignKeyAs422(tErr, TRANSLATION_LOCALE_INVALID, TRANSLATION_SAVE_FAILED, tStatus);
  }

  // Dedup defensivo: un featureId repetido violaría la PK (plan_id, feature_id) → 23505 → 500.
  const featureIds = Array.from(new Set(input.featureIds));
  if (featureIds.length > 0) {
    const { error: fErr, status: fStatus } = await admin
      .from("investep_plan_features")
      .insert(featureIds.map((fid) => ({ investep_plan_id: planId, investep_feature_id: fid })));
    if (fErr) {
      await rollback();
      throwForeignKeyAs422(fErr, FEATURE_INVALID, FEATURE_SAVE_FAILED, fStatus);
    }
  }

  return {
    id: planId,
    slug: data.slug,
    priceRegular: Number(data.price_regular),
    priceOffer: data.price_offer == null ? null : Number(data.price_offer),
    currency: data.currency,
    sortOrder: data.sort_order,
    isActive: data.is_active,
    translations: input.translations,
    featureIds,
  };
}

/**
 * Actualiza un paquete (PATCH parcial). `NOT_FOUND` (404) si no existe.
 *
 * Semántica de REEMPLAZO para las colecciones (consistente entre traducciones y features): el
 * array que mandás es el set deseado completo. Para traducciones, los locales ausentes en el
 * payload se borran; para features, el set queda exactamente igual a `featureIds`.
 *
 * Ambos reemplazos son SEGUROS ante input inválido: primero se insertan/upsertan las filas nuevas
 * (un locale o featureId inexistente falla por FK → 422 ANTES de borrar nada, dejando el estado
 * actual intacto) y recién después se borran las que sobran. OJO: esto NO da atomicidad — si un
 * fallo TRANSITORIO cae entre el insert/upsert y el delete, puede quedar un estado parcial (mismo
 * límite no-transaccional que el create); el reintento converge. Atomicidad real requeriría una RPC.
 *
 * El estado final se arma en memoria: a diferencia de `plans` (donde un trigger recalcula
 * `targetDailyPct`), acá no hay columna computada, así que una re-lectura sería un round-trip
 * desperdiciado. (Los precios ya vienen acotados a numeric(10,2) por Zod, así que la respuesta
 * en memoria coincide con lo persistido.)
 */
export async function updateAcademyPlan(
  admin: AppSupabaseClient,
  id: number,
  patch: AcademyPlanPatch,
): Promise<AcademyPlanAdminView> {
  // 404 antes de tocar nada. Además nos da los locales/featureIds actuales para el diff.
  const existing = await getAcademyPlanDetail(admin, id);
  if (!existing) throw new AppError("NOT_FOUND", "Paquete no encontrado.", 404);

  const scalarPayload = {
    ...(patch.priceRegular !== undefined && { price_regular: patch.priceRegular }),
    ...(patch.priceOffer !== undefined && { price_offer: patch.priceOffer }),
    ...(patch.currency !== undefined && { currency: patch.currency }),
    ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
    ...(patch.isActive !== undefined && { is_active: patch.isActive }),
  };
  if (Object.keys(scalarPayload).length > 0) {
    const { error, status } = await admin.from("investep_plans").update(scalarPayload).eq("id", id);
    if (error) throwPostgrestError(error, "No se pudo actualizar el paquete.", status);
  }

  // Traducciones (reemplazo): upsert de las provistas PRIMERO (valida locales por FK antes de
  // borrar nada), luego borra los locales que ya no estén en el payload.
  let translations = existing.translations;
  if (patch.translations && patch.translations.length > 0) {
    const { error, status } = await admin.from("investep_plan_translations").upsert(
      patch.translations.map((t) => ({
        investep_plan_id: id,
        locale: t.locale,
        name: t.name,
        subtitle: t.subtitle,
      })),
      { onConflict: "investep_plan_id,locale" },
    );
    if (error)
      throwForeignKeyAs422(error, TRANSLATION_LOCALE_INVALID, TRANSLATION_SAVE_FAILED, status);

    const keep = new Set(patch.translations.map((t) => t.locale));
    const localesToRemove = existing.translations
      .map((t) => t.locale)
      .filter((locale) => !keep.has(locale));
    if (localesToRemove.length > 0) {
      const { error: delErr, status: delStatus } = await admin
        .from("investep_plan_translations")
        .delete()
        .eq("investep_plan_id", id)
        .in("locale", localesToRemove);
      if (delErr) throwPostgrestError(delErr, TRANSLATION_SAVE_FAILED, delStatus);
    }
    translations = patch.translations;
  }

  // Features (reemplazo por DIFF): insertar las faltantes PRIMERO (un featureId inválido falla
  // por FK → 422 antes de borrar nada → set actual intacto), luego borrar las quitadas. El diff
  // además evita escrituras en un no-op (mismo set) y no vacía la matriz ante un error.
  let featureIds = existing.featureIds;
  if (patch.featureIds !== undefined) {
    const desired = Array.from(new Set(patch.featureIds));
    const current = new Set(existing.featureIds);
    const next = new Set(desired);
    const toAdd = desired.filter((fid) => !current.has(fid));
    const toRemove = existing.featureIds.filter((fid) => !next.has(fid));

    if (toAdd.length > 0) {
      const { error, status } = await admin
        .from("investep_plan_features")
        .insert(toAdd.map((fid) => ({ investep_plan_id: id, investep_feature_id: fid })));
      if (error) throwForeignKeyAs422(error, FEATURE_INVALID, FEATURE_SAVE_FAILED, status);
    }
    if (toRemove.length > 0) {
      const { error, status } = await admin
        .from("investep_plan_features")
        .delete()
        .eq("investep_plan_id", id)
        .in("investep_feature_id", toRemove);
      if (error) throwPostgrestError(error, FEATURE_SAVE_FAILED, status);
    }
    featureIds = desired;
  }

  // Estado final en memoria: `existing` con el patch aplicado (?? respeta 0/false; priceOffer
  // distingue null-explícito de "no tocar" vía !== undefined).
  return {
    id: existing.id,
    slug: existing.slug,
    priceRegular: patch.priceRegular ?? existing.priceRegular,
    priceOffer: patch.priceOffer !== undefined ? patch.priceOffer : existing.priceOffer,
    currency: patch.currency ?? existing.currency,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    isActive: patch.isActive ?? existing.isActive,
    translations,
    featureIds,
  };
}

/**
 * Elimina un paquete; traducciones y features asociadas caen por `ON DELETE CASCADE`.
 * `NOT_FOUND` (404) si no existía; si una membresía lo referencia, la FK lo impide → `CONFLICT` (409).
 */
export async function deleteAcademyPlan(admin: AppSupabaseClient, id: number): Promise<void> {
  const { data, error, status } = await admin
    .from("investep_plans")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "No se puede borrar: el paquete está referenciado por una membresía.",
        409,
      );
    }
    throwPostgrestError(error, "No se pudo borrar el paquete.", status);
  }
  if ((data?.length ?? 0) === 0) throw new AppError("NOT_FOUND", "Paquete no encontrado.", 404);
}
