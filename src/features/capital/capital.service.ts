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
  available: number;
}

export interface SetCapitalInput {
  totalCapital: number;
  currency: string;
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

/** Vista agregada del capital + asignaciones + cuánto queda disponible. */
export async function getCapitalView(
  repo: CapitalRepository,
  userId: string,
): Promise<CapitalView> {
  const [capital, allocations] = await Promise.all([
    repo.getCapital(userId),
    repo.listAllocations(userId),
  ]);
  const totalAllocated = sumDeposits(allocations);
  const available = (capital?.totalCapital ?? 0) - totalAllocated;
  return { capital, allocations, totalAllocated, available };
}

/** Setea/actualiza el capital total. Rechaza bajarlo por debajo de lo ya asignado. */
export async function setCapital(
  repo: CapitalRepository,
  userId: string,
  input: SetCapitalInput,
): Promise<CapitalRow> {
  const allocations = await repo.listAllocations(userId);
  const allocated = sumDeposits(allocations);
  if (input.totalCapital < allocated) {
    throw new AppError("CONFLICT", "El capital no puede ser menor a lo ya asignado.", 409);
  }
  const existingCurrency = allocations[0]?.currency;
  if (existingCurrency !== undefined && existingCurrency !== input.currency) {
    throw new AppError(
      "CONFLICT",
      "No se puede cambiar la moneda con asignaciones existentes.",
      409,
    );
  }
  return repo.upsertCapital(userId, { totalCapital: input.totalCapital, currency: input.currency });
}

/** Crea una asignación a un broker. account_type deriva del plan elegido. */
export async function createAllocation(
  repo: CapitalRepository,
  userId: string,
  input: CreateAllocationInput,
): Promise<AllocationRow> {
  const capital = await repo.getCapital(userId);
  if (!capital) {
    throw new AppError("CONFLICT", "Definí tu capital antes de asignar a un broker.", 409);
  }

  const plan = await repo.getPlan(input.investmentPlanId);
  if (!plan) {
    throw new AppError("NOT_FOUND", "El plan indicado no existe.", 404);
  }

  const broker = await repo.getBroker(input.brokerId);
  if (!broker) {
    throw new AppError("NOT_FOUND", "El broker indicado no existe.", 404);
  }

  const currency = input.currency ?? capital.currency;
  if (currency !== capital.currency) {
    throw new AppError("VALIDATION_ERROR", "La moneda debe coincidir con la del capital.", 422);
  }

  const accountType: AccountType = plan.accountType;
  const allocations = await repo.listAllocations(userId);

  if (allocations.some((a) => a.brokerId === input.brokerId && a.accountType === accountType)) {
    throw new AppError(
      "CONFLICT",
      "Ya existe una asignación para ese broker y tipo de cuenta.",
      409,
    );
  }

  if (sumDeposits(allocations) + input.initialDeposit > capital.totalCapital) {
    throw new AppError("CONFLICT", "La suma de depósitos supera el capital total.", 409);
  }

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
  if (sumDeposits(allocations, id) + initialDeposit > capital.totalCapital) {
    throw new AppError("CONFLICT", "La suma de depósitos supera el capital total.", 409);
  }

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
}
