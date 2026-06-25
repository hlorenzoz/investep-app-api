import { describe, expect, it } from "bun:test";
import { AppError } from "../../lib/errors";
import type {
  AllocationRow,
  BrokerRef,
  CapitalRepository,
  CapitalRow,
  PlanRef,
} from "./capital.repository";
import {
  createAllocation,
  deleteAllocation,
  getCapitalView,
  setCapital,
  updateAllocation,
} from "./capital.service";

interface StoredAllocation {
  userId: string;
  row: AllocationRow;
}

const DEFAULT_PLANS: PlanRef[] = [
  { id: 1, accountType: "equity", targetMonthlyPct: 25 },
  { id: 2, accountType: "equity", targetMonthlyPct: 50 },
  { id: 3, accountType: "options", targetMonthlyPct: 50 },
];

const DEFAULT_BROKERS: BrokerRef[] = [
  { id: 10, slug: "interactive-brokers" },
  { id: 11, slug: "tastytrade" },
];

function makeRepo(opts?: {
  capital?: Record<string, CapitalRow>;
  allocations?: StoredAllocation[];
  plans?: PlanRef[];
  brokers?: BrokerRef[];
}): CapitalRepository {
  const capital = new Map<string, CapitalRow>(Object.entries(opts?.capital ?? {}));
  const allocations: StoredAllocation[] = [...(opts?.allocations ?? [])];
  const plans = opts?.plans ?? DEFAULT_PLANS;
  const brokers = opts?.brokers ?? DEFAULT_BROKERS;
  let counter = 0;

  return {
    async getCapital(userId) {
      return capital.get(userId) ?? null;
    },
    async upsertCapital(userId, input) {
      capital.set(userId, { ...input });
      return { ...input };
    },
    async listAllocations(userId) {
      return allocations.filter((a) => a.userId === userId).map((a) => ({ ...a.row }));
    },
    async getAllocation(userId, id) {
      const found = allocations.find((a) => a.userId === userId && a.row.id === id);
      return found ? { ...found.row } : null;
    },
    async createAllocation(userId, input) {
      counter += 1;
      const plan = plans.find((p) => p.id === input.investmentPlanId);
      const broker = brokers.find((b) => b.id === input.brokerId);
      const row: AllocationRow = {
        id: `alloc-${counter}`,
        brokerId: input.brokerId,
        brokerSlug: broker?.slug ?? "",
        accountType: input.accountType,
        investmentPlanId: input.investmentPlanId,
        targetMonthlyPct: plan?.targetMonthlyPct ?? 0,
        initialDeposit: input.initialDeposit,
        currency: input.currency,
      };
      allocations.push({ userId, row });
      return { ...row };
    },
    async updateAllocation(userId, id, patch) {
      const found = allocations.find((a) => a.userId === userId && a.row.id === id);
      if (!found) throw new Error("fake: not found");
      const plan = plans.find((p) => p.id === patch.investmentPlanId);
      found.row = {
        ...found.row,
        investmentPlanId: patch.investmentPlanId,
        targetMonthlyPct: plan?.targetMonthlyPct ?? found.row.targetMonthlyPct,
        initialDeposit: patch.initialDeposit,
        currency: patch.currency,
      };
      return { ...found.row };
    },
    async deleteAllocation(userId, id) {
      const idx = allocations.findIndex((a) => a.userId === userId && a.row.id === id);
      if (idx === -1) return false;
      allocations.splice(idx, 1);
      return true;
    },
    async getPlan(planId) {
      return plans.find((p) => p.id === planId) ?? null;
    },
    async getBroker(brokerId) {
      return brokers.find((b) => b.id === brokerId) ?? null;
    },
  };
}

function alloc(userId: string, over: Partial<AllocationRow> & { id: string }): StoredAllocation {
  return {
    userId,
    row: {
      brokerId: 10,
      brokerSlug: "interactive-brokers",
      accountType: "equity",
      investmentPlanId: 1,
      targetMonthlyPct: 25,
      initialDeposit: 1000,
      currency: "USD",
      ...over,
    },
  };
}

const U = "user-1";

describe("getCapitalView", () => {
  it("estado vacío: capital null, totales en 0", async () => {
    const view = await getCapitalView(makeRepo(), U);
    expect(view.capital).toBeNull();
    expect(view.allocations).toEqual([]);
    expect(view.totalAllocated).toBe(0);
    expect(view.available).toBe(0);
  });

  it("calcula totalAllocated y available", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [
        alloc(U, { id: "a1", initialDeposit: 4000 }),
        alloc(U, { id: "a2", brokerId: 11, accountType: "options", initialDeposit: 1000 }),
      ],
    });
    const view = await getCapitalView(repo, U);
    expect(view.totalAllocated).toBe(5000);
    expect(view.available).toBe(0);
    expect(view.capital?.totalCapital).toBe(5000);
  });
});

describe("setCapital", () => {
  it("happy: setea el capital", async () => {
    const repo = makeRepo();
    const result = await setCapital(repo, U, { totalCapital: 5000, currency: "USD" });
    expect(result.totalCapital).toBe(5000);
  });

  it("409 si el capital nuevo es menor a lo ya asignado", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", initialDeposit: 4000 })],
    });
    await expect(
      setCapital(repo, U, { totalCapital: 3000, currency: "USD" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("409 si se cambia la moneda con asignaciones existentes", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", initialDeposit: 1000, currency: "USD" })],
    });
    await expect(
      setCapital(repo, U, { totalCapital: 5000, currency: "EUR" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("permite misma moneda con asignaciones existentes", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", initialDeposit: 1000, currency: "USD" })],
    });
    const result = await setCapital(repo, U, { totalCapital: 6000, currency: "USD" });
    expect(result.totalCapital).toBe(6000);
  });

  it("permite bajar el capital justo hasta lo ya asignado (borde ==)", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", initialDeposit: 4000, currency: "USD" })],
    });
    // 4000 === asignado: el chequeo es `< allocated`, el borde exacto debe permitirse.
    // Mata la mutación `<` -> `<=` (que rechazaría la igualdad).
    const result = await setCapital(repo, U, { totalCapital: 4000, currency: "USD" });
    expect(result.totalCapital).toBe(4000);
  });
});

describe("createAllocation", () => {
  function repoWithCapital(total = 5000) {
    return makeRepo({ capital: { [U]: { totalCapital: total, currency: "USD" } } });
  }

  it("happy: crea la asignación derivando account_type del plan", async () => {
    const repo = repoWithCapital();
    const result = await createAllocation(repo, U, {
      brokerId: 10,
      investmentPlanId: 1,
      initialDeposit: 4000,
    });
    expect(result.accountType).toBe("equity");
    expect(result.targetMonthlyPct).toBe(25);
    expect(result.initialDeposit).toBe(4000);
    expect(result.currency).toBe("USD");
  });

  it("409 sin capital seteado", async () => {
    await expect(
      createAllocation(makeRepo(), U, { brokerId: 10, investmentPlanId: 1, initialDeposit: 100 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("404 si el plan no existe", async () => {
    await expect(
      createAllocation(repoWithCapital(), U, {
        brokerId: 10,
        investmentPlanId: 999,
        initialDeposit: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("404 si el broker no existe", async () => {
    await expect(
      createAllocation(repoWithCapital(), U, {
        brokerId: 999,
        investmentPlanId: 1,
        initialDeposit: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("422 si la moneda no coincide con la del capital", async () => {
    await expect(
      createAllocation(repoWithCapital(), U, {
        brokerId: 10,
        investmentPlanId: 1,
        initialDeposit: 100,
        currency: "EUR",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("409 duplicado (mismo broker + account_type)", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [
        alloc(U, { id: "a1", brokerId: 10, accountType: "equity", initialDeposit: 1000 }),
      ],
    });
    await expect(
      createAllocation(repo, U, { brokerId: 10, investmentPlanId: 1, initialDeposit: 100 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("409 si supera el capital", async () => {
    await expect(
      createAllocation(repoWithCapital(5000), U, {
        brokerId: 10,
        investmentPlanId: 1,
        initialDeposit: 6000,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("permite la asignación que llena el capital exactamente (borde ==)", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [
        alloc(U, { id: "a1", brokerId: 10, accountType: "equity", initialDeposit: 4000 }),
      ],
    });
    // 4000 + 1000 === 5000: el chequeo es `> totalCapital`, el borde exacto entra.
    // Mata la mutación `>` -> `>=`.
    const result = await createAllocation(repo, U, {
      brokerId: 11,
      investmentPlanId: 1,
      initialDeposit: 1000,
    });
    expect(result.initialDeposit).toBe(1000);
  });

  it("permite una segunda asignación al mismo broker con distinto account_type", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 10000, currency: "USD" } },
      allocations: [
        alloc(U, {
          id: "a1",
          brokerId: 10,
          accountType: "equity",
          investmentPlanId: 1,
          initialDeposit: 1000,
        }),
      ],
    });
    // El duplicado se mide por (broker + account_type). Mismo broker, plan options (3) -> permitido.
    // Mata la mutación que ignore account_type en el chequeo de duplicado.
    const result = await createAllocation(repo, U, {
      brokerId: 10,
      investmentPlanId: 3,
      initialDeposit: 1000,
    });
    expect(result.accountType).toBe("options");
    expect(result.brokerId).toBe(10);
  });
});

describe("updateAllocation", () => {
  function repoWith(deposit = 1000) {
    return makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", investmentPlanId: 1, initialDeposit: deposit })],
    });
  }

  it("happy: cambia el depósito", async () => {
    const repo = repoWith();
    const result = await updateAllocation(repo, U, "a1", { initialDeposit: 2000 });
    expect(result.initialDeposit).toBe(2000);
  });

  it("happy: cambia el plan dentro del mismo account_type (25 -> 50)", async () => {
    const repo = repoWith();
    const result = await updateAllocation(repo, U, "a1", { investmentPlanId: 2 });
    expect(result.investmentPlanId).toBe(2);
    expect(result.targetMonthlyPct).toBe(50);
  });

  it("404 si la asignación no existe (o no es del usuario)", async () => {
    await expect(
      updateAllocation(repoWith(), U, "ghost", { initialDeposit: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("409 si no hay capital (estado inconsistente)", async () => {
    const repo = makeRepo({ allocations: [alloc(U, { id: "a1", initialDeposit: 1000 })] });
    await expect(updateAllocation(repo, U, "a1", { initialDeposit: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("404 si el plan nuevo no existe", async () => {
    await expect(
      updateAllocation(repoWith(), U, "a1", { investmentPlanId: 999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("422 si el plan nuevo es de otro account_type", async () => {
    // plan 3 = options; la asignación es equity
    await expect(
      updateAllocation(repoWith(), U, "a1", { investmentPlanId: 3 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("422 si la moneda no coincide con el capital", async () => {
    await expect(updateAllocation(repoWith(), U, "a1", { currency: "EUR" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("409 si el nuevo depósito supera el capital", async () => {
    await expect(
      updateAllocation(repoWith(), U, "a1", { initialDeposit: 6000 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("excluye el depósito propio al validar contra el capital (multi-asignación, borde ==)", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [
        alloc(U, { id: "a1", brokerId: 10, accountType: "equity", initialDeposit: 3000 }),
        alloc(U, { id: "a2", brokerId: 11, accountType: "options", initialDeposit: 1000 }),
      ],
    });
    // Subir a1 a 4000: (otras = 1000) + 4000 === 5000 -> entra SOLO si se excluye el viejo 3000.
    // Mata dos mutaciones: quitar `excludeId` (daría 3000+1000+4000 > 5000 -> 409) y `>` -> `>=`.
    const result = await updateAllocation(repo, U, "a1", { initialDeposit: 4000 });
    expect(result.initialDeposit).toBe(4000);
  });
});

describe("deleteAllocation", () => {
  it("happy: borra la asignación", async () => {
    const repo = makeRepo({
      capital: { [U]: { totalCapital: 5000, currency: "USD" } },
      allocations: [alloc(U, { id: "a1", initialDeposit: 1000 })],
    });
    await expect(deleteAllocation(repo, U, "a1")).resolves.toBeUndefined();
  });

  it("404 si no existe o no es del usuario", async () => {
    await expect(deleteAllocation(makeRepo(), U, "ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

/**
 * Property-based "casero" y DETERMINISTA: el stack no trae fast-check y se podó el tooling
 * a propósito (AGENTS.md §13), así que generamos los casos con un LCG sembrado (reproducible,
 * sin flakiness) y verificamos INVARIANTES de cálculo en vez de casos puntuales.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe("getCapitalView — invariantes de cálculo (property-based determinista)", () => {
  it("totalAllocated = Σ depósitos y available = capital - totalAllocated (200 casos)", async () => {
    const rng = makeRng(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const hasCapital = rng() > 0.2;
      const totalCapital = Math.round(rng() * 100000) / 100;
      const n = Math.floor(rng() * 6); // 0..5 asignaciones
      const allocations = Array.from({ length: n }, (_, k) =>
        alloc(U, { id: `p-${i}-${k}`, initialDeposit: Math.round(rng() * 20000) / 100 }),
      );
      const repo = makeRepo({
        capital: hasCapital ? { [U]: { totalCapital, currency: "USD" } } : {},
        allocations,
      });

      const view = await getCapitalView(repo, U);
      const expectedTotal = allocations.reduce((s, a) => s + a.row.initialDeposit, 0);
      const expectedCapital = hasCapital ? totalCapital : 0;

      // Invariantes que deben valer para CUALQUIER entrada:
      expect(view.totalAllocated).toBeCloseTo(expectedTotal, 6);
      expect(view.available).toBeCloseTo(expectedCapital - expectedTotal, 6);
      expect(view.totalAllocated + view.available).toBeCloseTo(expectedCapital, 6);
    }
  });
});
