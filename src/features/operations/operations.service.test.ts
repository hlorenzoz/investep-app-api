import { describe, expect, it } from "bun:test";
import type {
  AllocationRef,
  NewOperationRecord,
  OperationRecordPatch,
  OperationRow,
  OperationsRepository,
} from "./operations.repository";
import {
  createOperation,
  deleteOperation,
  getOperation,
  listOperations,
  updateOperation,
} from "./operations.service";

interface StoredOperation {
  userId: string;
  row: OperationRow;
}

interface StoredAllocation {
  userId: string;
  ref: AllocationRef;
}

const U = "user-1";

const DEFAULT_ALLOCATIONS: StoredAllocation[] = [
  { userId: U, ref: { id: "alloc-eq", accountType: "equity" } },
  { userId: U, ref: { id: "alloc-op", accountType: "options" } },
];

function makeRepo(opts?: {
  allocations?: StoredAllocation[];
  operations?: StoredOperation[];
}): OperationsRepository {
  const allocations = opts?.allocations ?? DEFAULT_ALLOCATIONS;
  const operations: StoredOperation[] = [...(opts?.operations ?? [])];
  let counter = 0;

  function applyPatch(row: OperationRow, patch: OperationRecordPatch): OperationRow {
    const next = { ...row };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (next as Record<string, unknown>)[key] = value;
      }
    }
    return next;
  }

  return {
    async getAllocation(userId, id) {
      const found = allocations.find((a) => a.userId === userId && a.ref.id === id);
      return found ? { ...found.ref } : null;
    },
    async listOperations(userId, filter) {
      return operations
        .filter((o) => o.userId === userId)
        .filter((o) => !filter?.allocationId || o.row.allocationId === filter.allocationId)
        .filter((o) => {
          if (filter?.status === "open") return o.row.soldAt === null;
          if (filter?.status === "closed") return o.row.soldAt !== null;
          return true;
        })
        .sort((a, b) => b.row.openedAt.localeCompare(a.row.openedAt))
        .map((o) => ({ ...o.row }));
    },
    async getOperation(userId, id) {
      const found = operations.find((o) => o.userId === userId && o.row.id === id);
      return found ? { ...found.row } : null;
    },
    async createOperation(userId, input: NewOperationRecord) {
      counter += 1;
      const row: OperationRow = {
        id: `op-${counter}`,
        allocationId: input.allocationId,
        accountType: input.accountType,
        ticker: input.ticker,
        openedAt: input.openedAt,
        quantity: input.quantity,
        buyPrice: input.buyPrice,
        limitPrice: input.limitPrice ?? null,
        strike: input.strike ?? null,
        expirationDate: input.expirationDate ?? null,
        contractType: input.contractType ?? null,
        soldAt: input.soldAt ?? null,
        sellPrice: input.sellPrice ?? null,
        strategy: input.strategy ?? null,
        notes: input.notes ?? null,
        url: input.url ?? null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      operations.push({ userId, row });
      return { ...row };
    },
    async updateOperation(userId, id, patch) {
      const found = operations.find((o) => o.userId === userId && o.row.id === id);
      if (!found) throw new Error("fake: not found");
      found.row = applyPatch(found.row, patch);
      return { ...found.row };
    },
    async deleteOperation(userId, id) {
      const idx = operations.findIndex((o) => o.userId === userId && o.row.id === id);
      if (idx === -1) return false;
      operations.splice(idx, 1);
      return true;
    },
  };
}

/** Fila equity abierta, con overrides. */
function equityRow(over: Partial<OperationRow> & { id: string }): StoredOperation {
  return {
    userId: U,
    row: {
      allocationId: "alloc-eq",
      accountType: "equity",
      ticker: "AAPL",
      openedAt: "2026-06-01T14:30:00.000Z",
      quantity: 10,
      buyPrice: 25.5,
      limitPrice: null,
      strike: null,
      expirationDate: null,
      contractType: null,
      soldAt: null,
      sellPrice: null,
      strategy: null,
      notes: null,
      url: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    },
  };
}

describe("createOperation — equity", () => {
  it("happy: crea la operación y deriva totalInvested = qty × precio (multiplicador 1)", async () => {
    const repo = makeRepo();
    const view = await createOperation(repo, U, {
      allocationId: "alloc-eq",
      ticker: "AAPL",
      openedAt: "2026-06-01T14:30:00.000Z",
      quantity: 10,
      buyPrice: 25.5,
    });
    expect(view.accountType).toBe("equity");
    expect(view.totalInvested).toBe(255);
    expect(view.status).toBe("open");
    expect(view.totalSale).toBeNull();
    expect(view.gainAmount).toBeNull();
    expect(view.gainPct).toBeNull();
  });

  it("permite cantidad fraccional en activos", async () => {
    const repo = makeRepo();
    const view = await createOperation(repo, U, {
      allocationId: "alloc-eq",
      ticker: "VOO",
      openedAt: "2026-06-01T14:30:00.000Z",
      quantity: 1.5,
      buyPrice: 400,
    });
    expect(view.totalInvested).toBe(600);
  });

  it("422 si trae campos de opciones (strike/expiration/contractType) en cuenta equity", async () => {
    const repo = makeRepo();
    await expect(
      createOperation(repo, U, {
        allocationId: "alloc-eq",
        ticker: "AAPL",
        openedAt: "2026-06-01T14:30:00.000Z",
        quantity: 10,
        buyPrice: 25.5,
        strike: 100,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });
});

describe("createOperation — options", () => {
  const base = {
    allocationId: "alloc-op",
    ticker: "^GSPC",
    openedAt: "2026-06-01T14:30:00.000Z",
    quantity: 2,
    buyPrice: 3.5,
    strike: 5300,
    expirationDate: "2026-07-17",
    contractType: "call" as const,
  };

  it("happy: crea la opción y deriva totalInvested con multiplicador ×100", async () => {
    const repo = makeRepo();
    const view = await createOperation(repo, U, base);
    expect(view.accountType).toBe("options");
    expect(view.strike).toBe(5300);
    expect(view.contractType).toBe("call");
    // 2 contratos × 3.50 × 100
    expect(view.totalInvested).toBe(700);
    expect(view.status).toBe("open");
  });

  it("crea una opción ya vendida y deriva totalSale, gainAmount y gainPct", async () => {
    const repo = makeRepo();
    const view = await createOperation(repo, U, {
      ...base,
      soldAt: "2026-06-15T18:00:00.000Z",
      sellPrice: 5,
    });
    expect(view.status).toBe("closed");
    expect(view.totalSale).toBe(1000);
    expect(view.gainAmount).toBe(300);
    // (5 − 3.5) / 3.5 × 100 = 42.857... → 42.86
    expect(view.gainPct).toBe(42.86);
  });

  it("404 si la cuenta no existe (o no es del usuario)", async () => {
    const repo = makeRepo();
    await expect(
      createOperation(repo, U, { ...base, allocationId: "ghost" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("422 si faltan strike, expirationDate o contractType en cuenta de opciones", async () => {
    const repo = makeRepo();
    await expect(createOperation(repo, U, { ...base, strike: undefined })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    await expect(
      createOperation(repo, U, { ...base, expirationDate: undefined }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      createOperation(repo, U, { ...base, contractType: undefined }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("422 si la cantidad de contratos no es entera", async () => {
    const repo = makeRepo();
    await expect(createOperation(repo, U, { ...base, quantity: 1.5 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("422 si viene fecha de venta sin precio de venta (o viceversa)", async () => {
    const repo = makeRepo();
    await expect(
      createOperation(repo, U, { ...base, soldAt: "2026-06-15T18:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(createOperation(repo, U, { ...base, sellPrice: 5 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("permite vender a 0 (la opción expira sin valor) con pérdida total", async () => {
    const repo = makeRepo();
    const view = await createOperation(repo, U, {
      ...base,
      soldAt: "2026-07-17T20:00:00.000Z",
      sellPrice: 0,
    });
    expect(view.totalSale).toBe(0);
    expect(view.gainAmount).toBe(-700);
    expect(view.gainPct).toBe(-100);
  });
});

describe("listOperations", () => {
  function repoWithMixed() {
    return makeRepo({
      operations: [
        equityRow({ id: "e1", openedAt: "2026-06-01T00:00:00.000Z" }),
        equityRow({
          id: "e2",
          openedAt: "2026-06-02T00:00:00.000Z",
          soldAt: "2026-06-10T00:00:00.000Z",
          sellPrice: 30,
        }),
        equityRow({
          id: "o1",
          allocationId: "alloc-op",
          accountType: "options",
          ticker: "^GSPC",
          quantity: 2,
          buyPrice: 3.5,
          strike: 5300,
          expirationDate: "2026-07-17",
          contractType: "call",
          openedAt: "2026-06-03T00:00:00.000Z",
        }),
      ],
    });
  }

  it("lista todas las operaciones del usuario (más reciente primero) con derivados", async () => {
    const views = await listOperations(repoWithMixed(), U, {});
    expect(views.map((v) => v.id)).toEqual(["o1", "e2", "e1"]);
    expect(views[0]?.totalInvested).toBe(700);
  });

  it("filtra por cuenta (allocationId)", async () => {
    const views = await listOperations(repoWithMixed(), U, { allocationId: "alloc-op" });
    expect(views.map((v) => v.id)).toEqual(["o1"]);
  });

  it("filtra por estado open/closed", async () => {
    const open = await listOperations(repoWithMixed(), U, { status: "open" });
    expect(open.map((v) => v.id)).toEqual(["o1", "e1"]);
    const closed = await listOperations(repoWithMixed(), U, { status: "closed" });
    expect(closed.map((v) => v.id)).toEqual(["e2"]);
  });
});

describe("getOperation", () => {
  it("happy: devuelve la operación con derivados (equity cerrada)", async () => {
    const repo = makeRepo({
      operations: [equityRow({ id: "e1", soldAt: "2026-06-10T00:00:00.000Z", sellPrice: 30 })],
    });
    const view = await getOperation(repo, U, "e1");
    expect(view.status).toBe("closed");
    expect(view.totalInvested).toBe(255);
    expect(view.totalSale).toBe(300);
    expect(view.gainAmount).toBe(45);
    // (30 − 25.5) / 25.5 × 100 = 17.647... → 17.65
    expect(view.gainPct).toBe(17.65);
  });

  it("404 si no existe o no es del usuario", async () => {
    await expect(getOperation(makeRepo(), U, "ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("updateOperation", () => {
  it("happy: registra la venta (soldAt + sellPrice) y deriva la ganancia", async () => {
    const repo = makeRepo({ operations: [equityRow({ id: "e1" })] });
    const view = await updateOperation(repo, U, "e1", {
      soldAt: "2026-06-10T00:00:00.000Z",
      sellPrice: 30,
    });
    expect(view.status).toBe("closed");
    expect(view.gainAmount).toBe(45);
  });

  it("happy: limpia la venta con null en ambos campos → vuelve a open", async () => {
    const repo = makeRepo({
      operations: [equityRow({ id: "e1", soldAt: "2026-06-10T00:00:00.000Z", sellPrice: 30 })],
    });
    const view = await updateOperation(repo, U, "e1", { soldAt: null, sellPrice: null });
    expect(view.status).toBe("open");
    expect(view.totalSale).toBeNull();
  });

  it("404 si la operación no existe", async () => {
    await expect(updateOperation(makeRepo(), U, "ghost", { buyPrice: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("422 si intenta setear campos de opciones en una operación equity", async () => {
    const repo = makeRepo({ operations: [equityRow({ id: "e1" })] });
    await expect(updateOperation(repo, U, "e1", { strike: 100 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("422 si la venta queda inconsistente tras el merge (solo un campo del par)", async () => {
    const repo = makeRepo({ operations: [equityRow({ id: "e1" })] });
    await expect(updateOperation(repo, U, "e1", { sellPrice: 30 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    // limpiar solo la fecha dejando el precio → inconsistente
    const repo2 = makeRepo({
      operations: [equityRow({ id: "e1", soldAt: "2026-06-10T00:00:00.000Z", sellPrice: 30 })],
    });
    await expect(updateOperation(repo2, U, "e1", { soldAt: null })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("422 si cambia la cantidad a fraccional en una operación de opciones", async () => {
    const repo = makeRepo({
      operations: [
        equityRow({
          id: "o1",
          allocationId: "alloc-op",
          accountType: "options",
          strike: 5300,
          expirationDate: "2026-07-17",
          contractType: "call",
        }),
      ],
    });
    await expect(updateOperation(repo, U, "o1", { quantity: 1.5 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });
});

describe("deleteOperation", () => {
  it("happy: borra la operación", async () => {
    const repo = makeRepo({ operations: [equityRow({ id: "e1" })] });
    await expect(deleteOperation(repo, U, "e1")).resolves.toBeUndefined();
    await expect(getOperation(repo, U, "e1")).rejects.toMatchObject({ status: 404 });
  });

  it("404 si no existe o no es del usuario", async () => {
    await expect(deleteOperation(makeRepo(), U, "ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
