import { afterEach, describe, expect, it, mock } from "bun:test";
import { createApp } from "../../app";
import type { Env } from "../../types/env";

const ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

const AUTH = { headers: { Authorization: "Bearer t" } };
const JSON_AUTH = {
  headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
};
const UUID = "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface AllocDb {
  id: string;
  broker_id: number;
  account_type: string;
  investment_plan_id: number;
  initial_deposit: string;
  currency: string;
  brokers: { slug: string };
  investment_plans: { target_monthly_pct: string };
}

function allocDb(over: Partial<AllocDb> & { id: string }): AllocDb {
  return {
    broker_id: 10,
    account_type: "equity",
    investment_plan_id: 1,
    initial_deposit: "1000.00",
    currency: "USD",
    brokers: { slug: "interactive-brokers" },
    investment_plans: { target_monthly_pct: "25.00" },
    ...over,
  };
}

interface Cfg {
  capital?: { total_capital: string; currency: string } | null;
  capitalUpsert?: { total_capital: string; currency: string };
  allocations?: AllocDb[];
  getAllocation?: AllocDb | null;
  plan?: { id: number; account_type: string; target_monthly_pct: string } | null;
  broker?: { id: number; slug: string } | null;
  created?: AllocDb;
  updated?: AllocDb;
  deleted?: { id: string }[];
  errorOn?: string;
}

/** Mock de fetch que enruta auth + PostgREST por tabla/método/filtro. */
function mockSupabase(cfg: Cfg = {}) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/auth/v1/user")) {
      return json({ id: "user-1", email: "u@example.com", user_metadata: {} });
    }
    if (cfg.errorOn && url.includes(cfg.errorOn)) {
      return json({ message: "boom", code: "", details: "", hint: "" }, 500);
    }
    if (url.includes("/user_capital")) {
      if (method === "POST") {
        return json(cfg.capitalUpsert ?? cfg.capital ?? { total_capital: "0.00", currency: "USD" });
      }
      return json(cfg.capital ? [cfg.capital] : []);
    }
    if (url.includes("/investment_plans")) {
      return json(cfg.plan ? [cfg.plan] : []);
    }
    if (url.includes("/brokers")) {
      return json(cfg.broker ? [cfg.broker] : []);
    }
    if (url.includes("/broker_allocations")) {
      if (method === "POST") return json(cfg.created);
      if (method === "PATCH") return json(cfg.updated);
      if (method === "DELETE") return json(cfg.deleted ?? []);
      if (/[?&]id=eq\./.test(url)) return json(cfg.getAllocation ? [cfg.getAllocation] : []);
      return json(cfg.allocations ?? []);
    }
    return json([]);
  }) as unknown as typeof fetch;
}

describe("capital endpoints", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token", async () => {
    const res = await createApp().request("/capital", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("GET /capital vacío → capital null, totales 0", async () => {
    mockSupabase({ capital: null, allocations: [] });
    const res = await createApp().request("/capital", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capital: unknown;
      totalAllocated: number;
      available: number;
    };
    expect(body.capital).toBeNull();
    expect(body.totalAllocated).toBe(0);
    expect(body.available).toBe(0);
  });

  it("GET /capital con datos → totales calculados y numeric coercido", async () => {
    mockSupabase({
      capital: { total_capital: "5000.00", currency: "USD" },
      allocations: [allocDb({ id: UUID, initial_deposit: "4000.00" })],
    });
    const res = await createApp().request("/capital", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capital: { totalCapital: number };
      allocations: { initialDeposit: number; targetMonthlyPct: number; brokerSlug: string }[];
      totalAllocated: number;
      available: number;
    };
    expect(body.capital.totalCapital).toBe(5000);
    expect(body.totalAllocated).toBe(4000);
    expect(body.available).toBe(1000);
    expect(body.allocations[0]?.initialDeposit).toBe(4000);
    expect(body.allocations[0]?.targetMonthlyPct).toBe(25);
    expect(body.allocations[0]?.brokerSlug).toBe("interactive-brokers");
  });

  it("PUT /capital happy → 200", async () => {
    mockSupabase({
      allocations: [],
      capitalUpsert: { total_capital: "5000.00", currency: "USD" },
    });
    const res = await createApp().request(
      "/capital",
      { ...JSON_AUTH, method: "PUT", body: JSON.stringify({ totalCapital: 5000 }) },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capital: { totalCapital: number } };
    expect(body.capital.totalCapital).toBe(5000);
  });

  it("PUT /capital con totalCapital negativo → 422 (Zod)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/capital",
      { ...JSON_AUTH, method: "PUT", body: JSON.stringify({ totalCapital: -1 }) },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("POST /capital/allocations happy → 201", async () => {
    mockSupabase({
      capital: { total_capital: "5000.00", currency: "USD" },
      plan: { id: 1, account_type: "equity", target_monthly_pct: "25.00" },
      broker: { id: 10, slug: "interactive-brokers" },
      allocations: [],
      created: allocDb({ id: UUID, initial_deposit: "4000.00" }),
    });
    const res = await createApp().request(
      "/capital/allocations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({ brokerId: 10, investmentPlanId: 1, initialDeposit: 4000 }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      allocation: { accountType: string; initialDeposit: number };
    };
    expect(body.allocation.accountType).toBe("equity");
    expect(body.allocation.initialDeposit).toBe(4000);
  });

  it("POST /capital/allocations que supera el capital → 409", async () => {
    mockSupabase({
      capital: { total_capital: "5000.00", currency: "USD" },
      plan: { id: 1, account_type: "equity", target_monthly_pct: "25.00" },
      broker: { id: 10, slug: "interactive-brokers" },
      allocations: [allocDb({ id: UUID, initial_deposit: "4000.00" })],
    });
    const res = await createApp().request(
      "/capital/allocations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({ brokerId: 11, investmentPlanId: 1, initialDeposit: 2000 }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
  });

  it("POST /capital/allocations con broker inexistente → 404", async () => {
    mockSupabase({
      capital: { total_capital: "5000.00", currency: "USD" },
      plan: { id: 1, account_type: "equity", target_monthly_pct: "25.00" },
      broker: null,
      allocations: [],
    });
    const res = await createApp().request(
      "/capital/allocations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({ brokerId: 999, investmentPlanId: 1, initialDeposit: 100 }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /capital/allocations/{id} happy → 200", async () => {
    mockSupabase({
      getAllocation: allocDb({ id: UUID, initial_deposit: "1000.00" }),
      capital: { total_capital: "5000.00", currency: "USD" },
      allocations: [allocDb({ id: UUID, initial_deposit: "1000.00" })],
      updated: allocDb({ id: UUID, initial_deposit: "2000.00" }),
    });
    const res = await createApp().request(
      `/capital/allocations/${UUID}`,
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ initialDeposit: 2000 }) },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allocation: { initialDeposit: number } };
    expect(body.allocation.initialDeposit).toBe(2000);
  });

  it("PATCH ajeno (no es del usuario) → 404", async () => {
    mockSupabase({ getAllocation: null });
    const res = await createApp().request(
      `/capital/allocations/${UUID}`,
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ initialDeposit: 2000 }) },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /capital/allocations/{id} happy → 200", async () => {
    mockSupabase({ deleted: [{ id: UUID }] });
    const res = await createApp().request(
      `/capital/allocations/${UUID}`,
      { ...JSON_AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("DELETE ajeno/inexistente → 404", async () => {
    mockSupabase({ deleted: [] });
    const res = await createApp().request(
      `/capital/allocations/${UUID}`,
      { ...JSON_AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("500 cuando la base falla (rama de error del repository)", async () => {
    mockSupabase({ errorOn: "/user_capital" });
    const res = await createApp().request("/capital", AUTH, ENV);
    expect(res.status).toBe(500);
  });
});
