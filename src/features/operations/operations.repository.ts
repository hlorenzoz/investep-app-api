import { throwPostgrestError } from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { Database } from "../../types/database.types";

export type AccountType = "equity" | "options";
export type ContractType = "call" | "put";
export type OperationStatus = "open" | "closed";

/**
 * Fila persistida de una operación de trading (registro del journal de una cuenta
 * de bróker). Los campos de opciones (strike, expirationDate, contractType) son
 * null en operaciones equity. Los montos derivados (total invertido, ganancia,
 * etc.) NO se persisten: se calculan en el service a partir de estos campos crudos.
 */
export interface OperationRow {
  id: string;
  allocationId: string;
  accountType: AccountType;
  ticker: string;
  openedAt: string;
  quantity: number;
  buyPrice: number;
  limitPrice: number | null;
  strike: number | null;
  expirationDate: string | null;
  contractType: ContractType | null;
  soldAt: string | null;
  sellPrice: number | null;
  strategy: string | null;
  notes: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Referencia mínima a la cuenta de bróker dueña del registro. */
export interface AllocationRef {
  id: string;
  accountType: AccountType;
}

export interface NewOperationRecord {
  allocationId: string;
  accountType: AccountType;
  ticker: string;
  openedAt: string;
  quantity: number;
  buyPrice: number;
  limitPrice?: number | null;
  strike?: number | null;
  expirationDate?: string | null;
  contractType?: ContractType | null;
  soldAt?: string | null;
  sellPrice?: number | null;
  strategy?: string | null;
  notes?: string | null;
  url?: string | null;
}

/**
 * Patch de una operación. `undefined` = no tocar; `null` = limpiar el campo
 * (solo en los campos anulables del dominio).
 */
export interface OperationRecordPatch {
  ticker?: string;
  openedAt?: string;
  quantity?: number;
  buyPrice?: number;
  limitPrice?: number | null;
  strike?: number;
  expirationDate?: string;
  contractType?: ContractType;
  soldAt?: string | null;
  sellPrice?: number | null;
  strategy?: string | null;
  notes?: string | null;
  url?: string | null;
}

export interface OperationListFilter {
  allocationId?: string;
  status?: OperationStatus;
}

/**
 * Puerto de acceso a datos del dominio operations. La lógica de negocio
 * (operations.service) depende de esta interfaz, no de Supabase → testeable
 * con un fake en memoria. Todas las operaciones reciben `userId`: el filtro
 * de pertenencia se aplica acá.
 */
export interface OperationsRepository {
  getAllocation(userId: string, id: string): Promise<AllocationRef | null>;
  listOperations(userId: string, filter?: OperationListFilter): Promise<OperationRow[]>;
  getOperation(userId: string, id: string): Promise<OperationRow | null>;
  createOperation(userId: string, input: NewOperationRecord): Promise<OperationRow>;
  updateOperation(userId: string, id: string, patch: OperationRecordPatch): Promise<OperationRow>;
  deleteOperation(userId: string, id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Implementación Supabase (service-role; el filtro user_id va en cada query).
// ---------------------------------------------------------------------------

const OPERATION_SELECT =
  "id, allocation_id, account_type, ticker, opened_at, quantity, buy_price, limit_price, " +
  "strike, expiration_date, contract_type, sold_at, sell_price, strategy, notes, url, " +
  "created_at, updated_at";

interface OperationQueryRow {
  id: string;
  allocation_id: string;
  account_type: AccountType;
  ticker: string;
  opened_at: string;
  quantity: number | string;
  buy_price: number | string;
  limit_price: number | string | null;
  strike: number | string | null;
  expiration_date: string | null;
  contract_type: ContractType | null;
  sold_at: string | null;
  sell_price: number | string | null;
  strategy: string | null;
  notes: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

function numOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function mapOperation(row: OperationQueryRow): OperationRow {
  return {
    id: row.id,
    allocationId: row.allocation_id,
    accountType: row.account_type,
    ticker: row.ticker,
    openedAt: row.opened_at,
    quantity: Number(row.quantity),
    buyPrice: Number(row.buy_price),
    limitPrice: numOrNull(row.limit_price),
    strike: numOrNull(row.strike),
    expirationDate: row.expiration_date,
    contractType: row.contract_type,
    soldAt: row.sold_at,
    sellPrice: numOrNull(row.sell_price),
    strategy: row.strategy,
    notes: row.notes,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type TradeOperationUpdate = Database["public"]["Tables"]["trade_operations"]["Update"];

/** Traduce el patch camelCase a columnas snake_case, incluyendo SOLO las claves definidas. */
function toDbPatch(patch: OperationRecordPatch): TradeOperationUpdate {
  const db: TradeOperationUpdate = {};
  if (patch.ticker !== undefined) db.ticker = patch.ticker;
  if (patch.openedAt !== undefined) db.opened_at = patch.openedAt;
  if (patch.quantity !== undefined) db.quantity = patch.quantity;
  if (patch.buyPrice !== undefined) db.buy_price = patch.buyPrice;
  if (patch.limitPrice !== undefined) db.limit_price = patch.limitPrice;
  if (patch.strike !== undefined) db.strike = patch.strike;
  if (patch.expirationDate !== undefined) db.expiration_date = patch.expirationDate;
  if (patch.contractType !== undefined) db.contract_type = patch.contractType;
  if (patch.soldAt !== undefined) db.sold_at = patch.soldAt;
  if (patch.sellPrice !== undefined) db.sell_price = patch.sellPrice;
  if (patch.strategy !== undefined) db.strategy = patch.strategy;
  if (patch.notes !== undefined) db.notes = patch.notes;
  if (patch.url !== undefined) db.url = patch.url;
  return db;
}

export function createSupabaseOperationsRepository(admin: AppSupabaseClient): OperationsRepository {
  return {
    async getAllocation(userId, id) {
      const { data, error, status } = await admin
        .from("broker_allocations")
        .select("id, account_type")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) throwPostgrestError(error, "No se pudo leer la cuenta de bróker.", status);
      if (!data) return null;
      return { id: data.id, accountType: data.account_type as AccountType };
    },

    async listOperations(userId, filter) {
      let query = admin
        .from("trade_operations")
        .select(OPERATION_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false });
      if (filter?.allocationId) {
        query = query.eq("allocation_id", filter.allocationId);
      }
      if (filter?.status === "open") {
        query = query.is("sold_at", null);
      } else if (filter?.status === "closed") {
        query = query.not("sold_at", "is", null);
      }
      const { data, error, status } = await query.returns<OperationQueryRow[]>();
      if (error) throwPostgrestError(error, "No se pudieron leer las operaciones.", status);
      return (data ?? []).map(mapOperation);
    },

    async getOperation(userId, id) {
      const { data, error, status } = await admin
        .from("trade_operations")
        .select(OPERATION_SELECT)
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle<OperationQueryRow>();
      if (error) throwPostgrestError(error, "No se pudo leer la operación.", status);
      return data ? mapOperation(data) : null;
    },

    async createOperation(userId, input) {
      const { data, error, status } = await admin
        .from("trade_operations")
        .insert({
          user_id: userId,
          allocation_id: input.allocationId,
          account_type: input.accountType,
          ticker: input.ticker,
          opened_at: input.openedAt,
          quantity: input.quantity,
          buy_price: input.buyPrice,
          limit_price: input.limitPrice ?? null,
          strike: input.strike ?? null,
          expiration_date: input.expirationDate ?? null,
          contract_type: input.contractType ?? null,
          sold_at: input.soldAt ?? null,
          sell_price: input.sellPrice ?? null,
          strategy: input.strategy ?? null,
          notes: input.notes ?? null,
          url: input.url ?? null,
        })
        .select(OPERATION_SELECT)
        .single<OperationQueryRow>();
      if (error || !data) throwPostgrestError(error, "No se pudo crear la operación.", status);
      return mapOperation(data);
    },

    async updateOperation(userId, id, patch) {
      const { data, error, status } = await admin
        .from("trade_operations")
        .update(toDbPatch(patch))
        .eq("user_id", userId)
        .eq("id", id)
        .select(OPERATION_SELECT)
        .single<OperationQueryRow>();
      if (error || !data) throwPostgrestError(error, "No se pudo actualizar la operación.", status);
      return mapOperation(data);
    },

    async deleteOperation(userId, id) {
      const { data, error, status } = await admin
        .from("trade_operations")
        .delete()
        .eq("user_id", userId)
        .eq("id", id)
        .select("id");
      if (error) throwPostgrestError(error, "No se pudo borrar la operación.", status);
      return (data?.length ?? 0) > 0;
    },
  };
}
