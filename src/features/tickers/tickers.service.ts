import { AppError } from "../../lib/errors";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  throwPostgrestError,
} from "../../lib/postgres-error";
import type { AppSupabaseClient } from "../../lib/supabase";
import type { Database } from "../../types/database.types";

type TickerRow = Database["public"]["Tables"]["tickers"]["Row"];

export interface ListTickersOptions {
  q?: string;
  assetClass?: string;
  sector?: string;
  planSlug?: string;
  page?: number;
  limit?: number;
}

export type RelationType = "x2" | "x3" | "inverso";

export interface TickerRelationInfo {
  symbol: string;
  name: string;
  relationType: RelationType;
  multiplier: number;
}

export type AssetClass = "stock" | "etf" | "index" | "crypto" | "commodity" | "currency";

export interface TickerView {
  id: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  price: number | null;
  changePct: number | null;
  prevClose: number | null;
  volume: number | null;
  avgVolume: number | null;
  fiftyTwoWHigh: number | null;
  fiftyTwoWLow: number | null;
  marketCap: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
  psRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  financials: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TickerDetail extends TickerView {
  relations: TickerRelationInfo[];
  plans: string[];
}

function mapRowToTicker(row: TickerRow): TickerView {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.asset_class as AssetClass,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
    country: row.country,
    price: row.price != null ? Number(row.price) : null,
    changePct: row.change_pct != null ? Number(row.change_pct) : null,
    prevClose: row.prev_close != null ? Number(row.prev_close) : null,
    volume: row.volume != null ? Number(row.volume) : null,
    avgVolume: row.avg_volume != null ? Number(row.avg_volume) : null,
    fiftyTwoWHigh: row.fifty_two_w_high != null ? Number(row.fifty_two_w_high) : null,
    fiftyTwoWLow: row.fifty_two_w_low != null ? Number(row.fifty_two_w_low) : null,
    marketCap: row.market_cap != null ? Number(row.market_cap) : null,
    peRatio: row.pe_ratio != null ? Number(row.pe_ratio) : null,
    forwardPe: row.forward_pe != null ? Number(row.forward_pe) : null,
    pegRatio: row.peg_ratio != null ? Number(row.peg_ratio) : null,
    psRatio: row.ps_ratio != null ? Number(row.ps_ratio) : null,
    pbRatio: row.pb_ratio != null ? Number(row.pb_ratio) : null,
    dividendYield: row.dividend_yield != null ? Number(row.dividend_yield) : null,
    financials: (row.financials as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInputToRow(input: Record<string, unknown>): Record<string, unknown> {
  const raw = {
    symbol: input.symbol,
    name: input.name,
    asset_class: input.assetClass,
    exchange: input.exchange,
    sector: input.sector,
    industry: input.industry,
    country: input.country,
    price: input.price,
    change_pct: input.changePct,
    prev_close: input.prevClose,
    volume: input.volume,
    avg_volume: input.avgVolume,
    fifty_two_w_high: input.fiftyTwoWHigh,
    fifty_two_w_low: input.fiftyTwoWLow,
    market_cap: input.marketCap,
    pe_ratio: input.peRatio,
    forward_pe: input.forwardPe,
    peg_ratio: input.pegRatio,
    ps_ratio: input.psRatio,
    pb_ratio: input.pbRatio,
    dividend_yield: input.dividendYield,
    financials: input.financials,
  };

  // Filtrar undefined
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/** Listar y buscar activos con filtros y paginación */
export async function listTickers(
  admin: AppSupabaseClient,
  options: ListTickersOptions = {},
): Promise<{ tickers: TickerView[]; total: number; page: number; limit: number }> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const selectFields = options.planSlug
    ? "*, investep_plan_tickers!inner(investep_plans!inner(slug))"
    : "*";

  let query = admin.from("tickers").select(selectFields, { count: "exact" });

  if (options.q) {
    const sanitizedQ = options.q.replace(/[(),]/g, "").trim();
    if (sanitizedQ) {
      const qUpper = sanitizedQ.toUpperCase();
      query = query.or(`symbol.ilike.%${qUpper}%,name.ilike.%${sanitizedQ}%`);
    }
  }

  if (options.assetClass) {
    query = query.eq("asset_class", options.assetClass);
  }

  if (options.sector) {
    query = query.eq("sector", options.sector);
  }

  if (options.planSlug) {
    query = query.eq("investep_plan_tickers.investep_plans.slug", options.planSlug);
  }

  // Ordenar alfabéticamente por símbolo
  query = query.order("symbol", { ascending: true });

  const { data, count, error, status } = await query.range(from, to);

  if (error) {
    throwPostgrestError(error, "No se pudieron obtener los activos.", status);
  }

  const tickers = ((data as unknown as TickerRow[]) ?? []).map(mapRowToTicker);
  return {
    tickers,
    total: count ?? 0,
    page,
    limit,
  };
}

interface RelationQueryRow {
  relation_type: string;
  multiplier: string | number;
  related_ticker: { symbol: string; name: string } | null;
}

interface PlanQueryRow {
  investep_plans: { slug: string } | null;
}

/** Obtener el detalle de un activo por símbolo (mayúsculas) */
export async function getTickerDetail(
  admin: AppSupabaseClient,
  symbol: string,
): Promise<TickerDetail | null> {
  const symbolUpper = symbol.toUpperCase();

  const { data, error, status } = await admin
    .from("tickers")
    .select(`
      *,
      ticker_relations!ticker_relations_parent_ticker_id_fkey(
        relation_type,
        multiplier,
        related_ticker:tickers!ticker_relations_related_ticker_id_fkey(symbol, name)
      ),
      investep_plan_tickers(
        investep_plans(slug)
      )
    `)
    .eq("symbol", symbolUpper)
    .maybeSingle();

  if (error) {
    throwPostgrestError(error, "No se pudo obtener el activo.", status);
  }

  if (!data) return null;

  // Formatear relaciones
  const relations = ((data.ticker_relations as unknown as RelationQueryRow[]) ?? []).map((r) => ({
    symbol: r.related_ticker?.symbol ?? "",
    name: r.related_ticker?.name ?? "",
    relationType: r.relation_type as RelationType,
    multiplier: Number(r.multiplier),
  }));

  // Formatear planes asociados
  const plans = ((data.investep_plan_tickers as unknown as PlanQueryRow[]) ?? [])
    .map((ipt) => ipt.investep_plans?.slug ?? "")
    .filter(Boolean);

  return {
    ...mapRowToTicker(data as unknown as TickerRow),
    relations,
    plans,
  };
}

/** Crear un activo */
export async function createTicker(
  admin: AppSupabaseClient,
  input: Record<string, unknown>,
): Promise<TickerView> {
  const row = mapInputToRow(input) as Database["public"]["Tables"]["tickers"]["Insert"];

  const { data, error, status } = await admin.from("tickers").insert(row).select().single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Ya existe un activo con ese símbolo.", 409);
    }
    throwPostgrestError(error, "No se pudo crear el activo.", status);
  }

  return mapRowToTicker(data as unknown as TickerRow);
}

/** Actualizar un activo */
export async function updateTicker(
  admin: AppSupabaseClient,
  id: number,
  patch: Record<string, unknown>,
): Promise<TickerView> {
  // Verificar existencia primero
  const { data: existing, error: readErr } = await admin
    .from("tickers")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (readErr) throwPostgrestError(readErr, "Error al leer el activo.");
  if (!existing) throw new AppError("NOT_FOUND", "El activo no existe.", 404);

  const row = mapInputToRow(patch) as Database["public"]["Tables"]["tickers"]["Update"];

  const { data, error, status } = await admin
    .from("tickers")
    .update(row)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "El símbolo ya está en uso por otro activo.", 409);
    }
    throwPostgrestError(error, "No se pudo actualizar el activo.", status);
  }

  return mapRowToTicker(data as unknown as TickerRow);
}

/** Eliminar un activo */
export async function deleteTicker(admin: AppSupabaseClient, id: number): Promise<void> {
  const { error, status, count } = await admin
    .from("tickers")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    throwPostgrestError(error, "No se pudo eliminar el activo.", status);
  }

  if (count === 0) {
    throw new AppError("NOT_FOUND", "El activo no existe.", 404);
  }
}

/** Establecer relación entre activos */
export async function associateRelation(
  admin: AppSupabaseClient,
  parentId: number,
  relatedId: number,
  relationType: string,
  multiplier: number,
): Promise<void> {
  if (parentId === relatedId) {
    throw new AppError("VALIDATION_ERROR", "No se puede relacionar un activo consigo mismo.", 422);
  }

  if (multiplier === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "El multiplicador de la relación no puede ser cero.",
      422,
    );
  }
  if (relationType === "inverso" && multiplier > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "El multiplicador para relaciones inversas debe ser negativo.",
      422,
    );
  }
  if ((relationType === "x2" || relationType === "x3") && multiplier < 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "El multiplicador para relaciones apalancadas (x2, x3) debe ser positivo.",
      422,
    );
  }

  const { error, status } = await admin.from("ticker_relations").insert({
    parent_ticker_id: parentId,
    related_ticker_id: relatedId,
    relation_type: relationType,
    multiplier,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "La relación entre estos activos ya existe.", 409);
    }
    if (isForeignKeyViolation(error)) {
      throw new AppError("NOT_FOUND", "El activo principal o el relacionado no existen.", 404);
    }
    throwPostgrestError(error, "No se pudo establecer la relación.", status);
  }
}

/** Eliminar relación entre activos */
export async function disassociateRelation(
  admin: AppSupabaseClient,
  parentId: number,
  relatedId: number,
  relationType: string,
): Promise<void> {
  const { error, status, count } = await admin
    .from("ticker_relations")
    .delete({ count: "exact" })
    .eq("parent_ticker_id", parentId)
    .eq("related_ticker_id", relatedId)
    .eq("relation_type", relationType);

  if (error) {
    throwPostgrestError(error, "No se pudo eliminar la relación.", status);
  }

  if (count === 0) {
    throw new AppError("NOT_FOUND", "La relación no existe.", 404);
  }
}

/** Asociar activo a plan */
export async function associatePlan(
  admin: AppSupabaseClient,
  tickerId: number,
  planId: number,
): Promise<void> {
  const { error, status } = await admin.from("investep_plan_tickers").insert({
    ticker_id: tickerId,
    investep_plan_id: planId,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "El activo ya está asociado a este plan.", 409);
    }
    if (isForeignKeyViolation(error)) {
      throw new AppError("NOT_FOUND", "El activo o el plan no existen.", 404);
    }
    throwPostgrestError(error, "No se pudo asociar el activo al plan.", status);
  }
}

/** Eliminar activo de plan */
export async function disassociatePlan(
  admin: AppSupabaseClient,
  tickerId: number,
  planId: number,
): Promise<void> {
  const { error, status, count } = await admin
    .from("investep_plan_tickers")
    .delete({ count: "exact" })
    .eq("ticker_id", tickerId)
    .eq("investep_plan_id", planId);

  if (error) {
    throwPostgrestError(error, "No se pudo eliminar la asociación del plan.", status);
  }

  if (count === 0) {
    throw new AppError("NOT_FOUND", "La asociación no existe.", 404);
  }
}
