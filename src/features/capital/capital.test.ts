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
  errorStatus?: number;
  errorMessage?: string;
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
      return json(
        { message: cfg.errorMessage ?? "boom", code: "", details: "", hint: "" },
        cfg.errorStatus ?? 500,
      );
    }
    if (url.includes("/rpc/transfer_capital")) {
      return json(null);
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

  it("POST /capital/allocations que supera el capital → 201 (auto-incrementa)", async () => {
    mockSupabase({
      capital: { total_capital: "5000.00", currency: "USD" },
      plan: { id: 1, account_type: "equity", target_monthly_pct: "25.00" },
      broker: { id: 10, slug: "interactive-brokers" },
      allocations: [allocDb({ id: UUID, initial_deposit: "4000.00" })],
      created: allocDb({ id: UUID, initial_deposit: "2000.00" }),
      capitalUpsert: { total_capital: "6000.00", currency: "USD" },
    });
    const res = await createApp().request(
      "/capital/allocations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({ brokerId: 10, investmentPlanId: 1, initialDeposit: 2000 }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
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

  it("503 cuando Supabase está caído (5xx transitorio del repository)", async () => {
    // outage/red caída → reintentable. NO debe ser 500 (no es un bug nuestro) ni 401.
    mockSupabase({ errorOn: "/user_capital", errorStatus: 500 });
    const res = await createApp().request("/capital", AUTH, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("500 ante un error genuino de PostgREST (4xx no transitorio)", async () => {
    // 4xx = problema de la request, no un outage → error interno (no reintentable).
    mockSupabase({ errorOn: "/user_capital", errorStatus: 400 });
    const res = await createApp().request("/capital", AUTH, ENV);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("PATCH con id malformado (no-UUID) → 422 (Zod param)", async () => {
    // Auth válido; falla la validación del param `id` ANTES de tocar el handler.
    // Mata la mutación que quite `.uuid()` del param (devolvería 404 en vez de 422).
    mockSupabase({});
    const res = await createApp().request(
      "/capital/allocations/not-a-uuid",
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ initialDeposit: 2000 }) },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("PUT /capital con currency malformada → 422 (Zod regex)", async () => {
    // "us" no matchea ^[A-Z]{3}$ -> 422. Mata la mutación que afloje el regex de currency.
    mockSupabase({});
    const res = await createApp().request(
      "/capital",
      { ...JSON_AUTH, method: "PUT", body: JSON.stringify({ totalCapital: 5000, currency: "us" }) },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("GET /capital no hace N+1: round-trips REST constantes ante más asignaciones", async () => {
    // listAllocations usa un select con joins embebidos (brokers/investment_plans): una sola
    // query, no una por asignación. Contamos los fetch a PostgREST (descontando el de auth)
    // con 1 vs 4 asignaciones; deben ser IGUALES. Mata una regresión N+1 (p.ej. getBroker por fila).
    const countRest = async (allocations: AllocDb[]) => {
      mockSupabase({ capital: { total_capital: "100000.00", currency: "USD" }, allocations });
      const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
      await createApp().request("/capital", AUTH, ENV);
      return fetchMock.mock.calls.filter((call) => !String(call[0]).includes("/auth/v1/user"))
        .length;
    };

    const one = await countRest([allocDb({ id: UUID, initial_deposit: "1000.00" })]);
    const many = await countRest([
      allocDb({ id: UUID, initial_deposit: "1000.00" }),
      allocDb({ id: "a2", broker_id: 11, initial_deposit: "2000.00" }),
      allocDb({ id: "a3", broker_id: 12, initial_deposit: "500.00" }),
      allocDb({ id: "a4", broker_id: 13, initial_deposit: "500.00" }),
    ]);

    expect(many).toBe(one); // independiente de N → no hay N+1
    expect(one).toBe(2); // getCapital + listAllocations
  });

  it("POST /capital/transfers happy → 200", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/capital/transfers",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          fromAllocationId: "capital",
          toAllocationId: UUID,
          amount: 500,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("POST /capital/transfers con origen y destino iguales → 422 (Zod/service)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/capital/transfers",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          fromAllocationId: "capital",
          toAllocationId: "capital",
          amount: 500,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("POST /capital/transfers con monto negativo → 422 (Zod)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/capital/transfers",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          fromAllocationId: "capital",
          toAllocationId: UUID,
          amount: -100,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("POST /capital/transfers con error de saldo insuficiente → 409", async () => {
    mockSupabase({
      errorOn: "/rpc/transfer_capital",
      errorStatus: 400, // PostgREST lanza 400 en raise exception
      errorMessage: "Saldo insuficiente en la cuenta de origen",
    });
    const res = await createApp().request(
      "/capital/transfers",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          fromAllocationId: "capital",
          toAllocationId: UUID,
          amount: 500,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Saldo insuficiente");
  });
});
