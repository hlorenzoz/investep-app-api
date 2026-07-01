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

function mockFetch(restBody: unknown, restStatus = 200, headers: Record<string, string> = {}) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      // Devolver un usuario normal
      return new Response(
        JSON.stringify({
          id: "uid-user",
          email: "user@example.com",
          app_metadata: { role: "user" },
          user_metadata: {},
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify(restBody), {
      status: restStatus,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch;
}

function mockFetchAdmin(restBody: unknown, restStatus = 200, headers: Record<string, string> = {}) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      // Devolver un admin
      return new Response(
        JSON.stringify({
          id: "uid-admin",
          email: "admin@example.com",
          app_metadata: { role: "admin" },
          user_metadata: {},
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify(restBody), {
      status: restStatus,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch;
}

const TICKER_RAW_ROW = {
  id: 1,
  symbol: "TSLA",
  name: "Tesla, Inc.",
  asset_class: "stock",
  exchange: "NASDAQ",
  sector: "Consumer Cyclical",
  industry: "Auto Manufacturers",
  country: "USA",
  price: "426.6400",
  change_pct: "1.4400",
  prev_close: "420.6000",
  volume: "8153033",
  avg_volume: "56280000",
  fifty_two_w_high: "498.8300",
  fifty_two_w_low: "288.7700",
  market_cap: "1579655830000.00",
  pe_ratio: "389.77",
  forward_pe: "176.09",
  peg_ratio: "7.18",
  ps_ratio: "16.37",
  pb_ratio: "19.05",
  dividend_yield: "0.0000",
  financials: { pe_ratio: 389.77 },
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
};

describe("Tickers API", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("GET /tickers", () => {
    it("401 sin token", async () => {
      const res = await createApp().request("/tickers", {}, ENV);
      expect(res.status).toBe(401);
    });

    it("200 lista de activos con paginacion y campos coercidos", async () => {
      mockFetch([TICKER_RAW_ROW], 200, { "content-range": "0-0/1" });

      const res = await createApp().request(
        "/tickers?page=1&limit=20",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      const body = (await res.json()) as {
        tickers: Array<{ symbol: string; price: number; marketCap: number; volume: number }>;
        pagination: { total: number };
      };
      expect(body.tickers).toBeArrayOfSize(1);
      expect(body.tickers[0]?.symbol).toBe("TSLA");
      expect(body.tickers[0]?.price).toBe(426.64);
      expect(body.tickers[0]?.marketCap).toBe(1579655830000);
      expect(body.tickers[0]?.volume).toBe(8153033);
      expect(body.pagination.total).toBe(1);
    });

    it("503 si Supabase falla", async () => {
      mockFetch({ message: "error" }, 500);

      const res = await createApp().request(
        "/tickers",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      expect(res.status).toBe(503);
    });
  });

  describe("GET /tickers/{symbol}", () => {
    it("200 detalle del ticker con planes y relaciones", async () => {
      mockFetch(
        {
          ...TICKER_RAW_ROW,
          ticker_relations: [
            {
              relation_type: "leveraged_long",
              multiplier: "2.00",
              related_ticker: { symbol: "TSLL", name: "TSLA Bull 2X" },
            },
          ],
          investep_plan_tickers: [{ investep_plans: { slug: "gold" } }],
        },
        200,
      );

      const res = await createApp().request(
        "/tickers/TSLA",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      const body = (await res.json()) as {
        symbol: string;
        relations: Array<{
          symbol: string;
          name: string;
          relationType: string;
          multiplier: number;
        }>;
        plans: string[];
      };
      expect(body.symbol).toBe("TSLA");
      expect(body.relations).toBeArrayOfSize(1);
      expect(body.relations[0]).toEqual({
        symbol: "TSLL",
        name: "TSLA Bull 2X",
        relationType: "leveraged_long",
        multiplier: 2.0,
      });
      expect(body.plans).toEqual(["gold"]);
    });

    it("404 si ticker no existe", async () => {
      mockFetch(null, 200); // maybeSingle devuelve null si no hay filas

      const res = await createApp().request(
        "/tickers/INVENTADO",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /admin/tickers", () => {
    it("403 si no es admin", async () => {
      mockFetch({}, 200);

      const res = await createApp().request(
        "/admin/tickers",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ symbol: "NVDA", name: "Nvidia" }),
        },
        ENV,
      );

      expect(res.status).toBe(403);
    });

    it("201 crea activo siendo admin", async () => {
      mockFetchAdmin(TICKER_RAW_ROW, 201);

      const res = await createApp().request(
        "/admin/tickers",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ symbol: "TSLA", name: "Tesla, Inc.", assetClass: "stock" }),
        },
        ENV,
      );

      const body = (await res.json()) as { ticker: { symbol: string } };
      expect(body.ticker.symbol).toBe("TSLA");
    });

    it("422 si el simbolo tiene formato invalido", async () => {
      mockFetchAdmin({}, 201);
      const res = await createApp().request(
        "/admin/tickers",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ symbol: "TSLA EMOJI 🚀", name: "Tesla, Inc." }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("409 conflicto si el simbolo ya existe", async () => {
      // 23505 = Unique violation en Postgres
      mockFetchAdmin({ code: "23505", message: "duplicate symbol" }, 409);

      const res = await createApp().request(
        "/admin/tickers",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ symbol: "TSLA", name: "Tesla, Inc." }),
        },
        ENV,
      );

      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /admin/tickers/{id}", () => {
    it("200 actualiza activo", async () => {
      // Mock de lectura primero (para verificar existencia) y luego update
      globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({
              id: "uid-admin",
              email: "admin@example.com",
              app_metadata: { role: "admin" },
            }),
            { status: 200 },
          );
        }
        // Si es GET
        if (init?.method === "GET" || !init?.method) {
          return new Response(JSON.stringify({ id: 1 }), { status: 200 });
        }
        // Si es PATCH
        return new Response(JSON.stringify({ ...TICKER_RAW_ROW, price: "450.0000" }), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      const res = await createApp().request(
        "/admin/tickers/1",
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ price: 450.0 }),
        },
        ENV,
      );

      const body = (await res.json()) as { ticker: { price: number } };
      expect(body.ticker.price).toBe(450.0);
    });

    it("404 si el activo no existe", async () => {
      globalThis.fetch = mock(async (input: unknown, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({
              id: "uid-admin",
              email: "admin@example.com",
              app_metadata: { role: "admin" },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(null), { status: 200 }); // GET devuelve null
      }) as unknown as typeof fetch;

      const res = await createApp().request(
        "/admin/tickers/999",
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ price: 450.0 }),
        },
        ENV,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /admin/tickers/{id}", () => {
    it("200 elimina activo", async () => {
      mockFetchAdmin({ id: 1 }, 200, { "content-range": "0-0/1" }); // PostgREST delete exitoso

      const res = await createApp().request(
        "/admin/tickers/1",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer token" },
        },
        ENV,
      );

      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);
    });
  });

  describe("Relations & Plans Associations", () => {
    it("POST /admin/tickers/{id}/relations 201 crea relacion", async () => {
      mockFetchAdmin({}, 201);

      const res = await createApp().request(
        "/admin/tickers/1/relations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            relatedTickerId: 2,
            relationType: "leveraged_long",
            multiplier: 2.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(201);
    });

    it("POST /admin/tickers/{id}/relations 422 previene auto-relacion", async () => {
      mockFetchAdmin({}, 200);

      const res = await createApp().request(
        "/admin/tickers/1/relations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            relatedTickerId: 1, // Mismo ID
            relationType: "inverse",
            multiplier: -1.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("POST /admin/tickers/{id}/plans 201 asocia plan", async () => {
      mockFetchAdmin({}, 201);

      const res = await createApp().request(
        "/admin/tickers/1/plans",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ planId: 3 }),
        },
        ENV,
      );

      expect(res.status).toBe(201);
    });

    it("DELETE /admin/tickers/{id}/plans 200 remueve plan", async () => {
      mockFetchAdmin({}, 200);

      const res = await createApp().request(
        "/admin/tickers/1/plans",
        {
          method: "DELETE",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ planId: 3 }),
        },
        ENV,
      );

      expect(res.status).toBe(200);
    });

    it("POST /admin/tickers/{id}/relations 422 previene multiplicador cero", async () => {
      mockFetchAdmin({}, 201);
      const res = await createApp().request(
        "/admin/tickers/1/relations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            relatedTickerId: 2,
            relationType: "leveraged_long",
            multiplier: 0.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("POST /admin/tickers/{id}/relations 422 previene signo inconsistente para short/inverse", async () => {
      mockFetchAdmin({}, 201);
      const res = await createApp().request(
        "/admin/tickers/1/relations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            relatedTickerId: 2,
            relationType: "inverse",
            multiplier: 1.5,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("POST /admin/tickers/{id}/relations 422 previene signo inconsistente para leveraged_long", async () => {
      mockFetchAdmin({}, 201);
      const res = await createApp().request(
        "/admin/tickers/1/relations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            relatedTickerId: 2,
            relationType: "leveraged_long",
            multiplier: -2.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });
  });
});
