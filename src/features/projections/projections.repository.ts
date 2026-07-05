import { throwPostgrestError } from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { ProjectionAccountType } from "./projections.service";

/** Tasa efectiva de un plan para proyectar: equity usa el mensual, options el diario. */
export interface PlanRate {
  accountType: ProjectionAccountType;
  /** % del plan: mensual para equity (25/50/100), diario para options (35/50). */
  ratePct: number;
}

/**
 * Resuelve la tasa del plan desde el catálogo (fuente autoritativa; el cliente NO manda
 * la tasa cruda). `null` si el plan no existe → el handler lo mapea a 404.
 *
 * Para options `target_monthly_pct` es un misnomer (guarda un diario); se prefiere
 * `target_daily_pct` y se cae al mensual si el diario aún no fue backfilleado.
 */
export async function getPlanRate(
  admin: AppSupabaseClient,
  planId: number,
): Promise<PlanRate | null> {
  const { data, error, status } = await admin
    .from("investment_plans")
    .select("account_type, target_monthly_pct, target_daily_pct")
    .eq("id", planId)
    .maybeSingle();
  if (error) throwPostgrestError(error, "No se pudo leer el plan.", status);
  if (!data) return null;

  const accountType = data.account_type as ProjectionAccountType;
  const ratePct =
    accountType === "options"
      ? Number(data.target_daily_pct ?? data.target_monthly_pct)
      : Number(data.target_monthly_pct);

  return { accountType, ratePct };
}
