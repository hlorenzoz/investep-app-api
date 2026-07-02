import { AppError } from "../../lib/errors";
import type {
  AccountType,
  AllocationRow,
  CapitalRepository,
  CapitalRow,
} from "./capital.repository";

export interface CapitalView {
  capital: CapitalRow | null;
  allocations: AllocationRow[];
  totalAllocated: number;
}

export interface CreateAllocationInput {
  brokerId: number;
  investmentPlanId: number;
  initialDeposit: number;
  currency?: string;
}

export interface UpdateAllocationInput {
  investmentPlanId?: number;
  initialDeposit?: number;
  currency?: string;
}

function sumDeposits(allocations: AllocationRow[], excludeId?: string): number {
  return allocations
    .filter((a) => a.id !== excludeId)
    .reduce((acc, a) => acc + a.initialDeposit, 0);
}

/**
 * Vista agregada del capital + asignaciones. `totalCapital` es un derivado:
 * la sumatoria del capital en cada cuenta de bróker (== `totalAllocated`).
 */
export async function getCapitalView(
  repo: CapitalRepository,
  userId: string,
): Promise<CapitalView> {
  const [capital, allocations] = await Promise.all([
    repo.getCapital(userId),
    repo.listAllocations(userId),
  ]);
  const totalAllocated = sumDeposits(allocations);
  return { capital, allocations, totalAllocated };
}

/** Crea una asignación a un broker. account_type deriva del plan elegido. */
export async function createAllocation(
  repo: CapitalRepository,
  userId: string,
  input: CreateAllocationInput,
): Promise<AllocationRow> {
  const plan = await repo.getPlan(input.investmentPlanId);
  if (!plan) {
    throw new AppError("NOT_FOUND", "El plan indicado no existe.", 404);
  }

  const broker = await repo.getBroker(input.brokerId);
  if (!broker) {
    throw new AppError("NOT_FOUND", "El broker indicado no existe.", 404);
  }

  let capital = await repo.getCapital(userId);
  const currency = input.currency ?? capital?.currency ?? "USD";

  if (capital && currency !== capital.currency) {
    throw new AppError("VALIDATION_ERROR", "La moneda debe coincidir con la del capital.", 422);
  }

  const accountType: AccountType = plan.accountType;
  const allocations = await repo.listAllocations(userId);

  const neededCapital = sumDeposits(allocations) + input.initialDeposit;
  capital = await repo.upsertCapital(userId, {
    totalCapital: neededCapital,
    currency,
  });

  return repo.createAllocation(userId, {
    brokerId: input.brokerId,
    accountType,
    investmentPlanId: input.investmentPlanId,
    initialDeposit: input.initialDeposit,
    currency,
  });
}

/** Edita una asignación (depósito, plan, moneda). El plan nuevo debe ser del mismo account_type. */
export async function updateAllocation(
  repo: CapitalRepository,
  userId: string,
  id: string,
  patch: UpdateAllocationInput,
): Promise<AllocationRow> {
  const existing = await repo.getAllocation(userId, id);
  if (!existing) {
    throw new AppError("NOT_FOUND", "Asignación no encontrada.", 404);
  }

  const capital = await repo.getCapital(userId);
  if (!capital) {
    throw new AppError("CONFLICT", "Definí tu capital antes de editar asignaciones.", 409);
  }

  let investmentPlanId = existing.investmentPlanId;
  if (
    patch.investmentPlanId !== undefined &&
    patch.investmentPlanId !== existing.investmentPlanId
  ) {
    const plan = await repo.getPlan(patch.investmentPlanId);
    if (!plan) {
      throw new AppError("NOT_FOUND", "El plan indicado no existe.", 404);
    }
    if (plan.accountType !== existing.accountType) {
      throw new AppError(
        "VALIDATION_ERROR",
        "El plan no corresponde al tipo de cuenta de la asignación.",
        422,
      );
    }
    investmentPlanId = patch.investmentPlanId;
  }

  const currency = patch.currency ?? existing.currency;
  if (currency !== capital.currency) {
    throw new AppError("VALIDATION_ERROR", "La moneda debe coincidir con la del capital.", 422);
  }

  const initialDeposit = patch.initialDeposit ?? existing.initialDeposit;
  const allocations = await repo.listAllocations(userId);
  const neededCapital = sumDeposits(allocations, id) + initialDeposit;
  await repo.upsertCapital(userId, { totalCapital: neededCapital, currency });

  return repo.updateAllocation(userId, id, { investmentPlanId, initialDeposit, currency });
}

/** Borra una asignación del usuario. 404 si no existe o no es suya. */
export async function deleteAllocation(
  repo: CapitalRepository,
  userId: string,
  id: string,
): Promise<void> {
  const deleted = await repo.deleteAllocation(userId, id);
  if (!deleted) {
    throw new AppError("NOT_FOUND", "Asignación no encontrada.", 404);
  }

  const remainingAllocations = await repo.listAllocations(userId);
  const remainingCapital = sumDeposits(remainingAllocations);
  const capital = await repo.getCapital(userId);
  const currency = capital?.currency ?? "USD";
  await repo.upsertCapital(userId, { totalCapital: remainingCapital, currency });
}

export interface TransferCapitalInput {
  fromAllocationId: string;
  toAllocationId: string;
  amount: number;
}

/** Transfiere capital de forma manual entre dos cuentas de bróker del usuario. */
export async function transferCapital(
  repo: CapitalRepository,
  userId: string,
  input: TransferCapitalInput,
): Promise<void> {
  if (input.fromAllocationId === input.toAllocationId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Las cuentas de origen y destino no pueden ser iguales.",
      422,
    );
  }

  await repo.transfer(userId, input.fromAllocationId, input.toAllocationId, input.amount);
}
