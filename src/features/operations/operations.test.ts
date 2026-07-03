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
const ALLOC_ID = "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b";
const OP_ID = "1c2d3e4f-5a6b-7c8d-9e0f-2a3b4c5d6e7f";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface OpDb {
  id: string;
  allocation_id: string;
  account_type: string;
  ticker: string;
  opened_at: string;
  quantity: string;
  buy_price: string;
  limit_price: string | null;
  strike: string | null;
  expiration_date: string | null;
  contract_type: string | null;
  sold_at: string | null;
  sell_price: string | null;
  strategy: string | null;
  notes: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila DB de una opción abierta (numerics como string: PostgREST puede devolverlos así). */
function opDb(over: Partial<OpDb> & { id: string }): OpDb {
  return {
    allocation_id: ALLOC_ID,
    account_type: "options",
    ticker: "^GSPC",
    opened_at: "2026-06-01T14:30:00.000Z",
    quantity: "2.0000",
    buy_price: "3.5000",
    limit_price: null,
    strike: "5300.0000",
    expiration_date: "2026-07-17",
    contract_type: "call",
    sold_at: null,
    sell_price: null,
    strategy: null,
    notes: null,
    url: "https://finance.yahoo.com/quote/%5EGSPC/options/",
    created_at: "2026-06-01T14:30:00.000Z",
    updated_at: "2026-06-01T14:30:00.000Z",
    ...over,
  };
}

interface Cfg {
  allocation?: { id: string; account_type: string } | null;
  operations?: OpDb[];
  operation?: OpDb | null;
  created?: OpDb;
  updated?: OpDb;
  deleted?: { id: string }[];
  errorOn?: string;
  errorStatus?: number;
  errorMessage?: string;
  errorCode?: string;
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
        { message: cfg.errorMessage ?? "boom", code: cfg.errorCode ?? "", details: "", hint: "" },
        cfg.errorStatus ?? 500,
      );
    }
    if (url.includes("/broker_allocations")) {
      return json(cfg.allocation ? [cfg.allocation] : []);
    }
    if (url.includes("/trade_operations")) {
      if (method === "POST") return json(cfg.created);
      if (method === "PATCH") return json(cfg.updated ?? null);
      if (method === "DELETE") return json(cfg.deleted ?? []);
      if (/[?&]id=eq\./.test(url)) return json(cfg.operation ? [cfg.operation] : []);
      return json(cfg.operations ?? []);
    }
    return json([]);
  }) as unknown as typeof fetch;
}

/** URLs de PostgREST llamadas por el mock (descartando la de auth). */
function restCalls(): string[] {
  const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes("/auth/v1/"));
}

describe("operations endpoints", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("401 sin token", async () => {
    const res = await createApp().request("/operations", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("GET /operations → 200 con derivados y numeric coercido", async () => {
    mockSupabase({ operations: [opDb({ id: OP_ID })] });
    const res = await createApp().request("/operations", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      operations: {
        id: string;
        quantity: number;
        buyPrice: number;
        strike: number;
        totalInvested: number;
        status: string;
        gainAmount: number | null;
      }[];
    };
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0]?.quantity).toBe(2);
    expect(body.operations[0]?.buyPrice).toBe(3.5);
    expect(body.operations[0]?.strike).toBe(5300);
    // 2 contratos × 3.50 × 100
    expect(body.operations[0]?.totalInvested).toBe(700);
    expect(body.operations[0]?.status).toBe("open");
    expect(body.operations[0]?.gainAmount).toBeNull();
  });

  it("GET /operations con filtros → la query PostgREST filtra por cuenta y estado", async () => {
    mockSupabase({ operations: [] });
    const res = await createApp().request(
      `/operations?allocationId=${ALLOC_ID}&status=open`,
      AUTH,
      ENV,
    );
    expect(res.status).toBe(200);
    const urls = restCalls();
    expect(urls.some((u) => u.includes(`allocation_id=eq.${ALLOC_ID}`))).toBe(true);
    expect(urls.some((u) => u.includes("sold_at=is.null"))).toBe(true);
  });

  it("GET /operations con status inválido → 422 (Zod query)", async () => {
    mockSupabase({});
    const res = await createApp().request("/operations?status=pending", AUTH, ENV);
    expect(res.status).toBe(422);
  });

  it("POST /operations happy (opciones) → 201 con derivados ×100", async () => {
    mockSupabase({
      allocation: { id: ALLOC_ID, account_type: "options" },
      created: opDb({ id: OP_ID }),
    });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "^GSPC",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 2,
          buyPrice: 3.5,
          strike: 5300,
          expirationDate: "2026-07-17",
          contractType: "call",
          url: "https://finance.yahoo.com/quote/%5EGSPC/options/",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      operation: { accountType: string; totalInvested: number; contractType: string };
    };
    expect(body.operation.accountType).toBe("options");
    expect(body.operation.totalInvested).toBe(700);
    expect(body.operation.contractType).toBe("call");
  });

  it("POST /operations con cuenta inexistente → 404", async () => {
    mockSupabase({ allocation: null });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "AAPL",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 25.5,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("POST /operations sin strike en cuenta de opciones → 422 (service)", async () => {
    mockSupabase({ allocation: { id: ALLOC_ID, account_type: "options" } });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "^GSPC",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 2,
          buyPrice: 3.5,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("POST /operations con ticker inválido → 422 (Zod)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "aapl!",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 25.5,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("GET /operations/{id} → 200", async () => {
    mockSupabase({
      operation: opDb({ id: OP_ID, sold_at: "2026-06-15T18:00:00.000Z", sell_price: "5.0000" }),
    });
    const res = await createApp().request(`/operations/${OP_ID}`, AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      operation: { status: string; totalSale: number; gainAmount: number; gainPct: number };
    };
    expect(body.operation.status).toBe("closed");
    expect(body.operation.totalSale).toBe(1000);
    expect(body.operation.gainAmount).toBe(300);
    expect(body.operation.gainPct).toBe(42.86);
  });

  it("GET /operations/{id} inexistente → 404", async () => {
    mockSupabase({ operation: null });
    const res = await createApp().request(`/operations/${OP_ID}`, AUTH, ENV);
    expect(res.status).toBe(404);
  });

  it("PATCH /operations/{id} happy (registrar venta) → 200", async () => {
    mockSupabase({
      operation: opDb({ id: OP_ID }),
      updated: opDb({ id: OP_ID, sold_at: "2026-06-15T18:00:00.000Z", sell_price: "5.0000" }),
    });
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      {
        ...JSON_AUTH,
        method: "PATCH",
        body: JSON.stringify({ soldAt: "2026-06-15T18:00:00.000Z", sellPrice: 5 }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { operation: { status: string; gainAmount: number } };
    expect(body.operation.status).toBe("closed");
    expect(body.operation.gainAmount).toBe(300);
  });

  it("PATCH /operations/{id} ajeno/inexistente → 404", async () => {
    mockSupabase({ operation: null });
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ buyPrice: 4 }) },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("PATCH con id malformado (no-UUID) → 422 (Zod param)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/operations/not-a-uuid",
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ buyPrice: 4 }) },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("DELETE /operations/{id} happy → 200", async () => {
    mockSupabase({ deleted: [{ id: OP_ID }] });
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      { ...AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: true });
  });

  it("DELETE /operations/{id} ajeno/inexistente → 404", async () => {
    mockSupabase({ deleted: [] });
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      { ...AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("503 cuando Supabase está caído (5xx transitorio del repository)", async () => {
    // outage/red caída → reintentable. NO debe ser 500 (no es un bug nuestro) ni 401.
    mockSupabase({ errorOn: "/trade_operations", errorStatus: 500 });
    const res = await createApp().request("/operations", AUTH, ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  // --- #1: cotas numeric(14,4) (no 500 de la DB) ---
  it("POST con buyPrice fuera del rango numeric(14,4) → 422 (Zod, no 500)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "AAPL",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 12345678901, // 11 dígitos enteros → overflow numeric(14,4)
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  it("POST con buyPrice sub-precisión (rondaría a 0) → 422 (Zod, no 500)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "AAPL",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 0.00001, // < 0.0001 → a escala 4 sería 0 → violaría buy_price > 0
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  // --- #2: datetime con offset horario aceptado ---
  it("POST con openedAt en offset horario (no Z) → 201", async () => {
    mockSupabase({
      allocation: { id: ALLOC_ID, account_type: "options" },
      created: opDb({ id: OP_ID }),
    });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "^GSPC",
          openedAt: "2026-06-01T09:30:00-04:00",
          quantity: 2,
          buyPrice: 3.5,
          strike: 5300,
          expirationDate: "2026-07-17",
          contractType: "call",
        }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
  });

  // --- #8: símbolo en minúsculas se normaliza a mayúsculas (schema compartido) ---
  it("POST con ticker en minúsculas → 201 (normalizado)", async () => {
    mockSupabase({
      allocation: { id: ALLOC_ID, account_type: "equity" },
      created: opDb({
        id: OP_ID,
        account_type: "equity",
        ticker: "AAPL",
        strike: null,
        expiration_date: null,
        contract_type: null,
      }),
    });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "aapl",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 25.5,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(201);
  });

  // --- #3: PATCH vacío → 422 (no 500) ---
  it("PATCH con body vacío ({}) → 422 (no 500)", async () => {
    mockSupabase({});
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({}) },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  // --- #4: violación de FK en el INSERT → 422 (no 500) ---
  it("POST con FK rota (cuenta borrada en carrera) → 422 (no 500)", async () => {
    mockSupabase({
      allocation: { id: ALLOC_ID, account_type: "equity" },
      errorOn: "/trade_operations",
      errorStatus: 409,
      errorCode: "23503",
      errorMessage: "insert or update on table violates foreign key constraint",
    });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "AAPL",
          openedAt: "2026-06-01T14:30:00.000Z",
          quantity: 10,
          buyPrice: 25.5,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });

  // --- #5: PATCH que matchea 0 filas (borrado en carrera) → 404 (no 500) ---
  it("PATCH que matchea 0 filas → 404 (no 500)", async () => {
    // getOperation encuentra la fila; el UPDATE no matchea ninguna (borrada en carrera).
    mockSupabase({ operation: opDb({ id: OP_ID }), updated: undefined });
    const res = await createApp().request(
      `/operations/${OP_ID}`,
      { ...JSON_AUTH, method: "PATCH", body: JSON.stringify({ buyPrice: 4 }) },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  // --- #7: fecha de venta anterior a la de compra → 422 ---
  it("POST con soldAt anterior a openedAt → 422", async () => {
    mockSupabase({ allocation: { id: ALLOC_ID, account_type: "equity" } });
    const res = await createApp().request(
      "/operations",
      {
        ...JSON_AUTH,
        method: "POST",
        body: JSON.stringify({
          allocationId: ALLOC_ID,
          ticker: "AAPL",
          openedAt: "2026-06-15T14:30:00.000Z",
          quantity: 10,
          buyPrice: 25.5,
          soldAt: "2026-06-01T14:30:00.000Z",
          sellPrice: 30,
        }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
  });
});
