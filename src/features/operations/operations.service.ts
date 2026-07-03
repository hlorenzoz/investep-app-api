import { AppError } from "../../lib/errors";
import type {
  AccountType,
  ContractType,
  OperationListFilter,
  OperationRecordPatch,
  OperationRow,
  OperationStatus,
  OperationsRepository,
} from "./operations.repository";

/**
 * Vista de una operación con los campos DERIVADOS del journal (no persistidos):
 * total invertido, total de venta, ganancia $ y %, y estado open/closed.
 * En opciones cada contrato representa 100 unidades del subyacente (multiplicador ×100).
 */
export interface OperationView extends OperationRow {
  status: OperationStatus;
  totalInvested: number;
  totalSale: number | null;
  gainAmount: number | null;
  gainPct: number | null;
}

export interface CreateOperationInput {
  allocationId: string;
  ticker: string;
  openedAt: string;
  quantity: number;
  buyPrice: number;
  limitPrice?: number;
  strike?: number;
  expirationDate?: string;
  contractType?: ContractType;
  soldAt?: string;
  sellPrice?: number;
  strategy?: string;
  notes?: string;
  url?: string;
}

export interface UpdateOperationInput extends OperationRecordPatch {}

const MULTIPLIER: Record<AccountType, number> = { equity: 1, options: 100 };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toView(row: OperationRow): OperationView {
  const multiplier = MULTIPLIER[row.accountType];
  const totalInvested = round2(row.quantity * row.buyPrice * multiplier);
  const closed = row.soldAt !== null && row.sellPrice !== null;
  const totalSale = closed ? round2(row.quantity * (row.sellPrice as number) * multiplier) : null;
  const gainAmount = totalSale === null ? null : round2(totalSale - totalInvested);
  const gainPct =
    closed && row.buyPrice > 0
      ? round2((((row.sellPrice as number) - row.buyPrice) / row.buyPrice) * 100)
      : null;
  return {
    ...row,
    status: closed ? "closed" : "open",
    totalInvested,
    totalSale,
    gainAmount,
    gainPct,
  };
}

interface TypedFields {
  quantity?: number;
  strike?: number | null;
  expirationDate?: string | null;
  contractType?: ContractType | null;
}

/**
 * Valida la coherencia de campos según el tipo de cuenta:
 * - options: exige strike/expirationDate/contractType (en create) y cantidad
 *   entera de contratos.
 * - equity: rechaza los campos exclusivos de opciones.
 */
function validateTypedFields(
  accountType: AccountType,
  fields: TypedFields,
  mode: "create" | "update",
): void {
  if (accountType === "options") {
    if (
      mode === "create" &&
      (fields.strike == null || fields.expirationDate == null || fields.contractType == null)
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Las operaciones de opciones requieren strike, expirationDate y contractType.",
        422,
      );
    }
    if (fields.quantity !== undefined && !Number.isInteger(fields.quantity)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "La cantidad de contratos de opciones debe ser un número entero.",
        422,
      );
    }
    return;
  }

  if (
    fields.strike !== undefined ||
    fields.expirationDate !== undefined ||
    fields.contractType !== undefined
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "strike, expirationDate y contractType aplican solo a operaciones de opciones.",
      422,
    );
  }
}

/** La venta se registra completa o no se registra: fecha y precio van juntos. */
function assertSalePair(soldAt: string | null, sellPrice: number | null): void {
  if ((soldAt === null) !== (sellPrice === null)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "La fecha de venta y el precio de venta deben indicarse juntos.",
      422,
    );
  }
}

/** Lista las operaciones del usuario (filtros opcionales por cuenta y estado). */
export async function listOperations(
  repo: OperationsRepository,
  userId: string,
  filter?: OperationListFilter,
): Promise<OperationView[]> {
  const rows = await repo.listOperations(userId, filter);
  return rows.map(toView);
}

/** Devuelve una operación del usuario. 404 si no existe o no es suya. */
export async function getOperation(
  repo: OperationsRepository,
  userId: string,
  id: string,
): Promise<OperationView> {
  const row = await repo.getOperation(userId, id);
  if (!row) {
    throw new AppError("NOT_FOUND", "Operación no encontrada.", 404);
  }
  return toView(row);
}

/**
 * Crea una operación en el registro de una cuenta de bróker. El tipo (equity/options)
 * NO viene en el body: deriva del account_type de la cuenta indicada.
 */
export async function createOperation(
  repo: OperationsRepository,
  userId: string,
  input: CreateOperationInput,
): Promise<OperationView> {
  const allocation = await repo.getAllocation(userId, input.allocationId);
  if (!allocation) {
    throw new AppError("NOT_FOUND", "La cuenta de bróker indicada no existe.", 404);
  }

  validateTypedFields(allocation.accountType, input, "create");
  assertSalePair(input.soldAt ?? null, input.sellPrice ?? null);

  const row = await repo.createOperation(userId, {
    ...input,
    accountType: allocation.accountType,
  });
  return toView(row);
}

/** Edita una operación. Los campos anulables se limpian con `null` explícito. */
export async function updateOperation(
  repo: OperationsRepository,
  userId: string,
  id: string,
  patch: UpdateOperationInput,
): Promise<OperationView> {
  const existing = await repo.getOperation(userId, id);
  if (!existing) {
    throw new AppError("NOT_FOUND", "Operación no encontrada.", 404);
  }

  validateTypedFields(existing.accountType, patch, "update");

  const soldAt = patch.soldAt === undefined ? existing.soldAt : patch.soldAt;
  const sellPrice = patch.sellPrice === undefined ? existing.sellPrice : patch.sellPrice;
  assertSalePair(soldAt, sellPrice);

  const row = await repo.updateOperation(userId, id, patch);
  return toView(row);
}

/** Borra una operación del usuario. 404 si no existe o no es suya. */
export async function deleteOperation(
  repo: OperationsRepository,
  userId: string,
  id: string,
): Promise<void> {
  const deleted = await repo.deleteOperation(userId, id);
  if (!deleted) {
    throw new AppError("NOT_FOUND", "Operación no encontrada.", 404);
  }
}
