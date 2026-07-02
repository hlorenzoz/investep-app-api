import { AppError } from "../../lib/errors";
import { throwPostgrestError } from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";

export type AccountType = "equity" | "options";

export interface CapitalRow {
  totalCapital: number;
  currency: string;
}

export interface AllocationRow {
  id: string;
  brokerId: number;
  brokerSlug: string;
  accountType: AccountType;
  investmentPlanId: number;
  targetMonthlyPct: number;
  initialDeposit: number;
  currency: string;
  createdAt: string;
}

export interface PlanRef {
  id: number;
  accountType: AccountType;
  targetMonthlyPct: number;
}

export interface BrokerRef {
  id: number;
  slug: string;
}

export interface NewAllocation {
  brokerId: number;
  accountType: AccountType;
  investmentPlanId: number;
  initialDeposit: number;
  currency: string;
}

export interface AllocationPatch {
  investmentPlanId: number;
  initialDeposit: number;
  currency: string;
}

/**
 * Puerto de acceso a datos del dominio capital. La lógica de negocio (capital.service)
 * depende de esta interfaz, no de Supabase → testeable con un fake en memoria.
 * Todas las operaciones reciben `userId`: el filtro de pertenencia se aplica acá.
 */
export interface CapitalRepository {
  getCapital(userId: string): Promise<CapitalRow | null>;
  upsertCapital(userId: string, input: CapitalRow): Promise<CapitalRow>;
  listAllocations(userId: string): Promise<AllocationRow[]>;
  getAllocation(userId: string, id: string): Promise<AllocationRow | null>;
  createAllocation(userId: string, input: NewAllocation): Promise<AllocationRow>;
  updateAllocation(userId: string, id: string, patch: AllocationPatch): Promise<AllocationRow>;
  deleteAllocation(userId: string, id: string): Promise<boolean>;
  getPlan(planId: number): Promise<PlanRef | null>;
  getBroker(brokerId: number): Promise<BrokerRef | null>;
  transfer(userId: string, fromId: string, toId: string, amount: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementación Supabase (service-role; el filtro user_id va en cada query).
// ---------------------------------------------------------------------------

const ALLOCATION_SELECT =
  "id, broker_id, account_type, investment_plan_id, initial_deposit, currency, created_at, brokers(slug), investment_plans(target_monthly_pct)";

interface AllocationQueryRow {
  id: string;
  broker_id: number;
  account_type: AccountType;
  investment_plan_id: number;
  initial_deposit: number | string;
  currency: string;
  created_at: string;
  brokers: { slug: string } | null;
  investment_plans: { target_monthly_pct: number | string } | null;
}

function mapAllocation(row: AllocationQueryRow): AllocationRow {
  return {
    id: row.id,
    brokerId: row.broker_id,
    brokerSlug: row.brokers?.slug ?? "",
    accountType: row.account_type,
    investmentPlanId: row.investment_plan_id,
    targetMonthlyPct: Number(row.investment_plans?.target_monthly_pct ?? 0),
    initialDeposit: Number(row.initial_deposit),
    currency: row.currency,
    createdAt: row.created_at,
  };
}

export function createSupabaseCapitalRepository(admin: AppSupabaseClient): CapitalRepository {
  return {
    async getCapital(userId) {
      const { data, error, status } = await admin
        .from("user_capital")
        .select("total_capital, currency")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throwPostgrestError(error, "No se pudo leer el capital.", status);
      if (!data) return null;
      return { totalCapital: Number(data.total_capital), currency: data.currency };
    },

    async upsertCapital(userId, input) {
      const { data, error, status } = await admin
        .from("user_capital")
        .upsert(
          { user_id: userId, total_capital: input.totalCapital, currency: input.currency },
          { onConflict: "user_id" },
        )
        .select("total_capital, currency")
        .single();
      if (error || !data) throwPostgrestError(error, "No se pudo guardar el capital.", status);
      return { totalCapital: Number(data.total_capital), currency: data.currency };
    },

    async listAllocations(userId) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .select(ALLOCATION_SELECT)
        .eq("user_id", userId)
        .order("created_at")
        .returns<AllocationQueryRow[]>();
      if (error) throwPostgrestError(error, "No se pudieron leer las asignaciones.", status);
      return (data ?? []).map(mapAllocation);
    },

    async getAllocation(userId, id) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .select(ALLOCATION_SELECT)
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle<AllocationQueryRow>();
      if (error) throwPostgrestError(error, "No se pudo leer la asignación.", status);
      return data ? mapAllocation(data) : null;
    },

    async createAllocation(userId, input) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .insert({
          user_id: userId,
          broker_id: input.brokerId,
          account_type: input.accountType,
          investment_plan_id: input.investmentPlanId,
          initial_deposit: input.initialDeposit,
          currency: input.currency,
        })
        .select(ALLOCATION_SELECT)
        .single<AllocationQueryRow>();
      if (error || !data) throwPostgrestError(error, "No se pudo crear la asignación.", status);
      return mapAllocation(data);
    },

    async updateAllocation(userId, id, patch) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .update({
          investment_plan_id: patch.investmentPlanId,
          initial_deposit: patch.initialDeposit,
          currency: patch.currency,
        })
        .eq("user_id", userId)
        .eq("id", id)
        .select(ALLOCATION_SELECT)
        .single<AllocationQueryRow>();
      if (error || !data)
        throwPostgrestError(error, "No se pudo actualizar la asignación.", status);
      return mapAllocation(data);
    },

    async deleteAllocation(userId, id) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .delete()
        .eq("user_id", userId)
        .eq("id", id)
        .select("id");
      if (error) throwPostgrestError(error, "No se pudo borrar la asignación.", status);
      return (data?.length ?? 0) > 0;
    },

    async getPlan(planId) {
      const { data, error, status } = await admin
        .from("investment_plans")
        .select("id, account_type, target_monthly_pct")
        .eq("id", planId)
        .maybeSingle();
      if (error) throwPostgrestError(error, "No se pudo leer el plan.", status);
      if (!data) return null;
      return {
        id: data.id,
        accountType: data.account_type as AccountType,
        targetMonthlyPct: Number(data.target_monthly_pct),
      };
    },

    async getBroker(brokerId) {
      const { data, error, status } = await admin
        .from("brokers")
        .select("id, slug")
        .eq("id", brokerId)
        .maybeSingle();
      if (error) throwPostgrestError(error, "No se pudo leer el broker.", status);
      return data ? { id: data.id, slug: data.slug } : null;
    },

    async transfer(userId, fromId, toId, amount) {
      const { error, status } = await admin.rpc("transfer_capital", {
        p_user_id: userId,
        p_from_id: fromId,
        p_to_id: toId,
        p_amount: amount,
      });
      if (error) {
        if (
          error.message.includes("insuficiente") ||
          error.message.includes("monto") ||
          error.message.includes("iguales")
        ) {
          throw new AppError("CONFLICT", error.message, 409);
        }
        if (error.message.includes("no existe")) {
          throw new AppError("NOT_FOUND", error.message, 404);
        }
        throwPostgrestError(error, "No se pudo realizar la transferencia.", status);
      }
    },
  };
}
