import { throwPostgrestError } from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";

export const DEFAULT_LOCALE = "es";

export type AccountType = "equity" | "options";

export interface PlanView {
  id: number;
  accountType: AccountType;
  targetMonthlyPct: number;
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
    .select("id, account_type, target_monthly_pct, investment_plan_translations(label, locale)")
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
    label: row.investment_plan_translations?.find((t) => t.locale === locale)?.label ?? null,
  }));

  return { locale, plans };
}
