import { describe, expect, it } from "bun:test";
import { CreateOperationRequestSchema, UpdateOperationRequestSchema } from "./operations.routes";

// El form "Fecha de compra/venta" es un date-picker → manda date-only (YYYY-MM-DD).
// La API debe aceptarlo (y normalizarlo a medianoche UTC) además del datetime ISO completo.
const base = {
  allocationId: "a56679c4-1573-462a-912a-f9a209ec388b",
  ticker: "AAPL",
  quantity: 12,
  buyPrice: 100,
};

describe("CreateOperationRequestSchema · openedAt/soldAt aceptan fecha sola", () => {
  it("openedAt date-only → se normaliza a medianoche UTC", () => {
    const r = CreateOperationRequestSchema.parse({ ...base, openedAt: "2026-07-04" });
    expect(r.openedAt).toBe("2026-07-04T00:00:00.000Z");
  });

  it("openedAt datetime ISO completo → pasa sin modificar", () => {
    const dt = "2026-07-04T14:30:00.000Z";
    const r = CreateOperationRequestSchema.parse({ ...base, openedAt: dt });
    expect(r.openedAt).toBe(dt);
  });

  it("openedAt con offset (-03:00) → pasa sin modificar", () => {
    const dt = "2026-07-04T14:30:00.000-03:00";
    const r = CreateOperationRequestSchema.parse({ ...base, openedAt: dt });
    expect(r.openedAt).toBe(dt);
  });

  it("openedAt basura → 422", () => {
    const r = CreateOperationRequestSchema.safeParse({ ...base, openedAt: "no-es-fecha" });
    expect(r.success).toBe(false);
  });

  it("soldAt date-only (venta cerrada) → también se normaliza", () => {
    const r = CreateOperationRequestSchema.parse({
      ...base,
      openedAt: "2026-07-01",
      soldAt: "2026-07-04",
      sellPrice: 120,
    });
    expect(r.soldAt).toBe("2026-07-04T00:00:00.000Z");
  });
});

describe("UpdateOperationRequestSchema · openedAt/soldAt aceptan fecha sola", () => {
  it("openedAt date-only → se normaliza a medianoche UTC", () => {
    const r = UpdateOperationRequestSchema.parse({ openedAt: "2026-07-04" });
    expect(r.openedAt).toBe("2026-07-04T00:00:00.000Z");
  });

  it("soldAt null → sigue permitido (deshacer venta)", () => {
    const r = UpdateOperationRequestSchema.parse({ soldAt: null, sellPrice: null });
    expect(r.soldAt).toBeNull();
  });
});
