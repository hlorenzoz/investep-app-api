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

export type AccountType = "equity" | "options";

export interface PlanView {
  id: number;
  accountType: AccountType;
  targetMonthlyPct: number;
  targetDailyPct: number | null;
  label: string | null;
}

export interface ListPlansOptions {
  locale?: string;
  accountType?: AccountType;
}

/** Forma cruda de la fila con la traducción embebida (PostgREST). */
interface PlanQueryRow {
  id: number;
  account_type: AccountType;
  // PostgREST devuelve numeric como string; coercemos al mapear.
  target_monthly_pct: number | string;
  target_daily_pct: number | string | null;
  investment_plan_translations: { label: string; locale: string }[] | null;
}

/**
 * Lista el catálogo de planes con la label del locale pedido (default `es`).
 * Un solo round-trip con la traducción embebida; se elige la label del locale en memoria.
 */
export async function listPlans(
  admin: AppSupabaseClient,
  options: ListPlansOptions = {},
): Promise<{ locale: string; plans: PlanView[] }> {
  const locale = options.locale ?? DEFAULT_LOCALE;

  let query = admin
    .from("investment_plans")
    .select(
      "id, account_type, target_monthly_pct, target_daily_pct, investment_plan_translations(label, locale)",
    )
    .order("account_type")
    .order("target_monthly_pct");

  if (options.accountType) {
    query = query.eq("account_type", options.accountType);
  }

  const { data, error, status } = await query.returns<PlanQueryRow[]>();
  if (error) throwPostgrestError(error, "No se pudieron obtener los planes.", status);

  const plans: PlanView[] = (data ?? []).map((row) => ({
    id: row.id,
    accountType: row.account_type,
    targetMonthlyPct: Number(row.target_monthly_pct),
    targetDailyPct: row.target_daily_pct != null ? Number(row.target_daily_pct) : null,
    label: row.investment_plan_translations?.find((t) => t.locale === locale)?.label ?? null,
  }));

  return { locale, plans };
}

// ---------------------------------------------------------------------------
// Administración del catálogo (admin-only). El gate de autorización vive en el
// router (`requireAdmin`); estas funciones asumen que ya pasó. Operan con el
// service-role client, que bypassa RLS.
// ---------------------------------------------------------------------------

/** Una traducción (label) de un plan en un locale. */
export interface PlanTranslation {
  locale: string;
  label: string;
}

/** Vista admin de un plan: incluye `targetDailyPct` (lo calcula un trigger) y TODAS las traducciones. */
export interface PlanAdminView {
  id: number;
  accountType: AccountType;
  targetMonthlyPct: number;
  targetDailyPct: number | null;
  translations: PlanTranslation[];
}

/** Datos para crear un plan: el par (accountType, targetMonthlyPct) debe ser único. */
export interface NewPlan {
  accountType: AccountType;
  targetMonthlyPct: number;
  translations: PlanTranslation[];
}

/**
 * Parche de un plan. `accountType` NO es modificable a propósito: forma parte de la
 * clave única y de la FK compuesta `(id, account_type)` que referencian las cuentas
 * y asignaciones; cambiarlo rompería la integridad referencial.
 */
export interface PlanPatch {
  targetMonthlyPct?: number;
  translations?: PlanTranslation[];
}

const PLAN_DETAIL_SELECT =
  "id, account_type, target_monthly_pct, target_daily_pct, investment_plan_translations(label, locale)";

interface PlanDetailRow {
  id: number;
  account_type: AccountType;
  target_monthly_pct: number | string;
  target_daily_pct: number | string | null;
  investment_plan_translations: { label: string; locale: string }[] | null;
}

/** Mapper único snake_case → camelCase para la vista admin, reutilizado por get/update (DRY). */
function toPlanAdminView(row: PlanDetailRow): PlanAdminView {
  return {
    id: row.id,
    accountType: row.account_type,
    targetMonthlyPct: Number(row.target_monthly_pct),
    targetDailyPct: row.target_daily_pct === null ? null : Number(row.target_daily_pct),
    translations: (row.investment_plan_translations ?? []).map((t) => ({
      locale: t.locale,
      label: t.label,
    })),
  };
}

const PLAN_UNIQUE_MSG = "Ya existe un plan con ese tipo de cuenta y target mensual.";

/** Devuelve un plan con sus traducciones embebidas (un solo round-trip); `null` si no existe. */
export async function getPlanDetail(
  admin: AppSupabaseClient,
  id: number,
): Promise<PlanAdminView | null> {
  const { data, error, status } = await admin
    .from("investment_plans")
    .select(PLAN_DETAIL_SELECT)
    .eq("id", id)
    .limit(1)
    .returns<PlanDetailRow[]>();
  if (error) throwPostgrestError(error, "No se pudo leer el plan.", status);
  const row = data?.[0];
  return row ? toPlanAdminView(row) : null;
}

// Mensajes del mapeo de error de traducciones (FK 23503 = locale desconocido → 422, vía helper).
const TRANSLATION_LOCALE_INVALID = "Una de las traducciones usa un locale desconocido.";
const TRANSLATION_SAVE_FAILED = "No se pudieron guardar las traducciones del plan.";

/**
 * Crea un plan y sus traducciones. El par (accountType, targetMonthlyPct) duplicado →
 * `CONFLICT` (409). PostgREST no es transaccional entre tablas: si las traducciones
 * fallan tras crear el plan, se borra el plan (rollback best-effort) y se propaga el error.
 */
export async function createPlan(admin: AppSupabaseClient, input: NewPlan): Promise<PlanAdminView> {
  const { data, error, status } = await admin
    .from("investment_plans")
    .insert({ account_type: input.accountType, target_monthly_pct: input.targetMonthlyPct })
    .select("id, account_type, target_monthly_pct, target_daily_pct")
    .single<{
      id: number;
      account_type: AccountType;
      target_monthly_pct: number | string;
      target_daily_pct: number | string | null;
    }>();
  if (error || !data) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", PLAN_UNIQUE_MSG, 409);
    throwPostgrestError(error, "No se pudo crear el plan.", status);
  }

  if (input.translations.length > 0) {
    const { error: tErr, status: tStatus } = await admin
      .from("investment_plan_translations")
      .insert(
        input.translations.map((t) => ({
          investment_plan_id: data.id,
          locale: t.locale,
          label: t.label,
        })),
      );
    if (tErr) {
      // Rollback best-effort del plan recién creado (PostgREST no es transaccional entre tablas).
      // Si el propio rollback falla, lo logueamos para que quede diagnosticable un plan huérfano
      // (sin traducciones) — nunca datos sensibles, solo el id (AGENTS.md §5).
      const { error: rollbackErr } = await admin
        .from("investment_plans")
        .delete()
        .eq("id", data.id);
      if (rollbackErr) {
        // Evento estructurado (§12): un plan huérfano (sin traducciones) por un rollback fallido
        // es justo lo que querés poder rastrear/alertar. Solo el id, nunca datos sensibles (§5).
        logError("plan_rollback_failed", { planId: data.id });
      }
      throwForeignKeyAs422(tErr, TRANSLATION_LOCALE_INVALID, TRANSLATION_SAVE_FAILED, tStatus);
    }
  }

  return {
    id: data.id,
    accountType: data.account_type,
    targetMonthlyPct: Number(data.target_monthly_pct),
    targetDailyPct: data.target_daily_pct === null ? null : Number(data.target_daily_pct),
    translations: input.translations,
  };
}

/**
 * Actualiza un plan: `targetMonthlyPct` (el trigger recalcula `targetDailyPct` para equity) y/o
 * sus traducciones (upsert por locale). `NOT_FOUND` (404) si no existe; par duplicado → `CONFLICT`.
 */
export async function updatePlan(
  admin: AppSupabaseClient,
  id: number,
  patch: PlanPatch,
): Promise<PlanAdminView> {
  // 404 antes de tocar nada (y soporta el caso de solo-traducciones sin update del plan).
  const existing = await getPlanDetail(admin, id);
  if (!existing) throw new AppError("NOT_FOUND", "Plan no encontrado.", 404);

  if (patch.targetMonthlyPct !== undefined) {
    const { error, status } = await admin
      .from("investment_plans")
      .update({ target_monthly_pct: patch.targetMonthlyPct })
      .eq("id", id);
    if (error) {
      if (isUniqueViolation(error)) throw new AppError("CONFLICT", PLAN_UNIQUE_MSG, 409);
      throwPostgrestError(error, "No se pudo actualizar el plan.", status);
    }
  }

  if (patch.translations && patch.translations.length > 0) {
    const { error, status } = await admin.from("investment_plan_translations").upsert(
      patch.translations.map((t) => ({ investment_plan_id: id, locale: t.locale, label: t.label })),
      { onConflict: "investment_plan_id,locale" },
    );
    if (error)
      throwForeignKeyAs422(error, TRANSLATION_LOCALE_INVALID, TRANSLATION_SAVE_FAILED, status);
  }

  // Estado final: incluye el targetDailyPct ya recalculado por el trigger.
  const updated = await getPlanDetail(admin, id);
  if (!updated) throw new AppError("NOT_FOUND", "Plan no encontrado.", 404);
  return updated;
}

/** Elimina un plan; sus traducciones caen por `ON DELETE CASCADE`. `NOT_FOUND` (404) si no existía. */
export async function deletePlan(admin: AppSupabaseClient, id: number): Promise<void> {
  const { data, error, status } = await admin
    .from("investment_plans")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "No se puede borrar: el plan está referenciado por asignaciones.",
        409,
      );
    }
    throwPostgrestError(error, "No se pudo borrar el plan.", status);
  }
  if ((data?.length ?? 0) === 0) throw new AppError("NOT_FOUND", "Plan no encontrado.", 404);
}
