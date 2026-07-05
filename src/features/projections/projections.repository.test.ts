import { describe, expect, it } from "bun:test";
import type { AppSupabaseClient } from "../../lib/supabase";
import { getPlanRate } from "./projections.repository";

/** Fake mínimo del client: `from().select().eq().maybeSingle()` → el resultado inyectado. */
function fakeAdmin(result: { data: unknown; error: unknown; status: number }): AppSupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => result,
  };
  return { from: () => builder } as unknown as AppSupabaseClient;
}

const ok = (data: unknown) => ({ data, error: null, status: 200 });

describe("getPlanRate — resolución de tasa por tipo de cuenta", () => {
  const cases: Array<{
    name: string;
    row: Record<string, unknown>;
    expected: { accountType: "equity" | "options"; ratePct: number };
  }> = [
    {
      name: "equity 25 → usa el mensual",
      row: { account_type: "equity", target_monthly_pct: "25.00", target_daily_pct: "1.25" },
      expected: { accountType: "equity", ratePct: 25 },
    },
    {
      name: "equity 50 → usa el mensual (ignora el diario)",
      row: { account_type: "equity", target_monthly_pct: "50.00", target_daily_pct: "2.50" },
      expected: { accountType: "equity", ratePct: 50 },
    },
    {
      name: "options 35 → usa el diario",
      row: { account_type: "options", target_monthly_pct: "35.00", target_daily_pct: "35.00" },
      expected: { accountType: "options", ratePct: 35 },
    },
    {
      name: "options 50 → usa el diario",
      row: { account_type: "options", target_monthly_pct: "50.00", target_daily_pct: "50.00" },
      expected: { accountType: "options", ratePct: 50 },
    },
    {
      name: "options con diario NULL → cae al mensual (pre-backfill)",
      row: { account_type: "options", target_monthly_pct: "35.00", target_daily_pct: null },
      expected: { accountType: "options", ratePct: 35 },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      expect(await getPlanRate(fakeAdmin(ok(c.row)), 1)).toEqual(c.expected);
    });
  }

  it("plan inexistente (data null) → null", async () => {
    expect(await getPlanRate(fakeAdmin(ok(null)), 999)).toBeNull();
  });

  it("error transitorio de PostgREST (5xx) → SERVICE_UNAVAILABLE (503)", async () => {
    const admin = fakeAdmin({ data: null, error: { message: "boom" }, status: 500 });
    await expect(getPlanRate(admin, 1)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("error genuino de PostgREST (4xx) → INTERNAL_ERROR (500)", async () => {
    const admin = fakeAdmin({ data: null, error: { message: "bad" }, status: 400 });
    await expect(getPlanRate(admin, 1)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
    });
  });
});
