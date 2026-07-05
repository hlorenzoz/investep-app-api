import { describe, expect, it } from "bun:test";
import {
  buildProjection,
  equityDailyRate,
  optionsDailyRate,
  type ProjectionGrouping,
} from "./projections.service";

const START = new Date("2026-07-01T00:00:00.000Z");

describe("equityDailyRate", () => {
  it("raíz 20 del mensual → 20 días componen exactamente el mensual del plan", () => {
    expect((1 + equityDailyRate(25)) ** 20).toBeCloseTo(1.25, 10);
    expect((1 + equityDailyRate(50)) ** 20).toBeCloseTo(1.5, 10);
    expect((1 + equityDailyRate(100)) ** 20).toBeCloseTo(2.0, 10);
  });
});

describe("optionsDailyRate", () => {
  it("10% del capital a la tasa diaria del plan (35% → 3.5%/día, 50% → 5%/día)", () => {
    expect(optionsDailyRate(35)).toBeCloseTo(0.035, 12);
    expect(optionsDailyRate(50)).toBeCloseTo(0.05, 12);
  });
});

describe("buildProjection — activos (equity 25% mensual, base 15000)", () => {
  const monthly = buildProjection({
    baseAmount: 15000,
    startDate: START,
    grouping: "monthly",
    accountType: "equity",
    ratePct: 25,
  });

  it("horizonte mensual por defecto = 36 períodos (3 años)", () => {
    expect(monthly).toHaveLength(36);
  });

  it("mes 1: 15000 → +3750 (25% exacto) → 18750", () => {
    expect(monthly[0]).toMatchObject({
      periodIndex: 1,
      startBalance: 15000,
      yieldAmount: 3750,
      endBalance: 18750,
    });
  });

  it("mes 2: 18750 → +4687.5 → 23437.5 (compuesto)", () => {
    expect(monthly[1]).toMatchObject({
      startBalance: 18750,
      yieldAmount: 4687.5,
      endBalance: 23437.5,
    });
  });

  it("mes 12: saldo final = base × 1.25^12 (≈ 218278.73)", () => {
    expect(monthly[11]?.endBalance).toBe(218278.73);
  });

  it("labels mensuales en ES con año de 2 dígitos", () => {
    expect(monthly[0]?.label).toBe("Jul 26");
    expect(monthly[1]?.label).toBe("Ago 26");
  });

  it("diario: primer día compone a la raíz 20 (≈ +168.29, NO el 1.25% simple del front)", () => {
    const daily = buildProjection({
      baseAmount: 15000,
      startDate: START,
      grouping: "daily",
      accountType: "equity",
      ratePct: 25,
    });
    expect(daily).toHaveLength(240);
    expect(daily[0]?.startBalance).toBe(15000);
    expect(daily[0]?.endBalance).toBeCloseTo(15168.29, 2);
    // El primer día cae en miércoles 1 Jul 2026; el índice 1 saltea a jueves 2.
    expect(daily[0]?.label).toBe("1 Jul");
  });
});

describe("buildProjection — opciones (options 35% diario, base 1000)", () => {
  const daily = buildProjection({
    baseAmount: 1000,
    startDate: START,
    grouping: "daily",
    accountType: "options",
    ratePct: 35,
  });

  it("día 1: 1000 → +35 (3.5% sobre el total) → 1035", () => {
    expect(daily[0]).toMatchObject({ startBalance: 1000, yieldAmount: 35, endBalance: 1035 });
  });

  it("día 2: compone sobre 1035", () => {
    expect(daily[1]?.startBalance).toBe(1035);
    expect(daily[1]?.endBalance).toBeCloseTo(1071.22, 2);
  });
});

describe("consistencia canónica: las 4 vistas convergen al mismo saldo por horizonte", () => {
  const base = { baseAmount: 15000, startDate: START, accountType: "equity" as const, ratePct: 25 };
  const groupings: ProjectionGrouping[] = ["daily", "weekly", "monthly", "yearly"];
  const series = Object.fromEntries(
    groupings.map((g) => [g, buildProjection({ ...base, grouping: g })]),
  ) as Record<ProjectionGrouping, ReturnType<typeof buildProjection>>;

  it("día 240 (daily) = semana 48 (weekly) = mes 12 (monthly) = año 1 (yearly)", () => {
    const target = series.yearly[0]?.endBalance;
    expect(target).toBe(218278.73);
    expect(series.daily[239]?.endBalance).toBe(target);
    expect(series.weekly[47]?.endBalance).toBe(target);
    expect(series.monthly[11]?.endBalance).toBe(target);
  });

  it("options: día 20 (daily) = semana 4 (weekly) = mes 1 (monthly)", () => {
    const o = { baseAmount: 1000, startDate: START, accountType: "options" as const, ratePct: 35 };
    const d = buildProjection({ ...o, grouping: "daily" });
    const w = buildProjection({ ...o, grouping: "weekly" });
    const m = buildProjection({ ...o, grouping: "monthly" });
    const target = m[0]?.endBalance;
    expect(d[19]?.endBalance).toBe(target);
    expect(w[3]?.endBalance).toBe(target);
  });
});

describe("buildProjection — vistas semanal y anual (datasets)", () => {
  it("semanal equity 25%: 48 períodos/año, semana 1 compone 5 días hábiles", () => {
    const w = buildProjection({
      baseAmount: 15000,
      startDate: START,
      grouping: "weekly",
      accountType: "equity",
      ratePct: 25,
    });
    expect(w).toHaveLength(48);
    expect(w[0]?.startBalance).toBe(15000);
    // 5 días hábiles = 1.25^(5/20) = 1.25^0.25 ⇒ ~+5.74%
    expect(w[0]?.endBalance).toBeCloseTo(15860.57, 2);
    expect(w[0]?.label).toBe("Semana 1");
    expect(w[1]?.label).toBe("Semana 2");
  });

  it("anual equity 25%: 5 períodos, labels por año, año 2 = base × 1.25^24", () => {
    const y = buildProjection({
      baseAmount: 15000,
      startDate: START,
      grouping: "yearly",
      accountType: "equity",
      ratePct: 25,
    });
    expect(y).toHaveLength(5);
    expect(y[0]?.label).toBe("2026");
    expect(y[1]?.label).toBe("2027");
    expect(y[1]?.endBalance).toBe(round2(15000 * 1.25 ** 24));
  });
});

describe("buildProjection — fechas y labels (edge cases)", () => {
  it("diario saltea fines de semana: arrancando sábado, el día 1 cae en lunes", () => {
    // 4 Jul 2026 es sábado (1 Jul es miércoles). Día 0 = sábado tal cual; día 1 saltea domingo.
    const sat = new Date("2026-07-04T00:00:00.000Z");
    const d = buildProjection({
      baseAmount: 1000,
      startDate: sat,
      grouping: "daily",
      accountType: "options",
      ratePct: 35,
    });
    expect(d[0]?.date).toBe("2026-07-04");
    expect(d[1]?.date).toBe("2026-07-06"); // lunes (saltea dom 5)
    expect(d[2]?.date).toBe("2026-07-07");
  });

  it("mensual: rollover de año en el label (Nov 2026 + 2 = Ene 2027)", () => {
    const nov = new Date("2026-11-01T00:00:00.000Z");
    const m = buildProjection({
      baseAmount: 1000,
      startDate: nov,
      grouping: "monthly",
      accountType: "equity",
      ratePct: 25,
    });
    expect(m[0]?.label).toBe("Nov 26");
    expect(m[2]?.label).toBe("Ene 27");
  });
});

describe("buildProjection — datasets parametrizados (conteo y anclas)", () => {
  const groupings: Array<{ g: ProjectionGrouping; n: number }> = [
    { g: "daily", n: 240 },
    { g: "weekly", n: 48 },
    { g: "monthly", n: 36 },
    { g: "yearly", n: 5 },
  ];
  const bases = [1, 100.5, 1000, 250000];
  const rates: Array<{ accountType: "equity" | "options"; ratePct: number }> = [
    { accountType: "equity", ratePct: 25 },
    { accountType: "equity", ratePct: 100 },
    { accountType: "options", ratePct: 35 },
    { accountType: "options", ratePct: 50 },
  ];

  for (const { g, n } of groupings) {
    for (const base of bases) {
      for (const rate of rates) {
        it(`${g} · base ${base} · ${rate.accountType} ${rate.ratePct}%: n=${n} y período 1 arranca en base`, () => {
          const series = buildProjection({
            baseAmount: base,
            startDate: START,
            grouping: g,
            ...rate,
          });
          expect(series).toHaveLength(n);
          expect(series[0]?.startBalance).toBe(round2(base));
          expect(series[0]?.periodIndex).toBe(1);
          expect(series.at(-1)?.periodIndex).toBe(n);
          // Serie estrictamente creciente (tasas positivas) y períodos encadenados.
          for (let i = 1; i < series.length; i++) {
            expect(series[i]?.startBalance).toBe(series[i - 1]?.endBalance);
          }
        });
      }
    }
  }
});

describe("buildProjection — horizonte e invariantes", () => {
  it("override de años ajusta el número de períodos", () => {
    const p = buildProjection({
      baseAmount: 1000,
      startDate: START,
      grouping: "monthly",
      accountType: "equity",
      ratePct: 25,
      years: 1,
    });
    expect(p).toHaveLength(12);
  });

  it("start + yield = end en cada período (200 casos deterministas)", () => {
    let state = 0x1234abcd >>> 0;
    const rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
    const groupings: ProjectionGrouping[] = ["daily", "weekly", "monthly", "yearly"];
    for (let i = 0; i < 200; i++) {
      const accountType = rng() > 0.5 ? "equity" : "options";
      const series = buildProjection({
        baseAmount: 100 + Math.round(rng() * 100000) / 100,
        startDate: START,
        grouping: groupings[Math.floor(rng() * 4)] ?? "monthly",
        accountType,
        ratePct: accountType === "equity" ? 25 : 35,
        years: 1,
      });
      for (const p of series) {
        // Invariante presentacional: los valores mostrados cuadran exactamente.
        expect(round2(p.startBalance + p.yieldAmount)).toBe(p.endBalance);
        expect(p.endBalance).toBeGreaterThanOrEqual(p.startBalance);
      }
    }
  });
});

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
