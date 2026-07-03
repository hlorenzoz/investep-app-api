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
              relation_type: "x2",
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
          isFavorite: boolean;
        }>;
        plans: string[];
      };
      expect(body.symbol).toBe("TSLA");
      expect(body.relations).toBeArrayOfSize(1);
      expect(body.relations[0]).toEqual({
        symbol: "TSLL",
        name: "TSLA Bull 2X",
        relationType: "x2",
        multiplier: 2.0,
        isFavorite: false,
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

  describe("GET /tickers/relations-overview", () => {
    it("401 sin token", async () => {
      const res = await createApp().request("/tickers/relations-overview", {}, ENV);
      expect(res.status).toBe(401);
    });

    it("200 agrupa activos y sectores desde una sola query agregada", async () => {
      mockFetch(
        [
          {
            relation_type: "x2",
            multiplier: "2.00",
            parent: {
              symbol: "TSLA",
              name: "Tesla, Inc.",
              asset_class: "stock",
              sector: "Consumer Cyclical",
            },
            related: { symbol: "TSLL", name: "Direxion Daily TSLA Bull 2X Shares" },
          },
          {
            relation_type: "inverso",
            multiplier: "-1.00",
            parent: {
              symbol: "TSLA",
              name: "Tesla, Inc.",
              asset_class: "stock",
              sector: "Consumer Cyclical",
            },
            related: { symbol: "TSLS", name: "Direxion Daily TSLA Bear 1X Shares" },
          },
          {
            relation_type: "inverso",
            multiplier: "-3.00",
            parent: {
              symbol: "XLK",
              name: "Technology SPDR",
              asset_class: "etf",
              sector: "Technology",
            },
            related: { symbol: "TECS", name: "Direxion Daily Technology Bear 3X Shares" },
          },
        ],
        200,
      );

      const res = await createApp().request(
        "/tickers/relations-overview",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      expect(res.status).toBe(200);
      type Link = {
        symbol: string;
        name: string;
        relationType: string;
        multiplier: number;
        isFavorite: boolean;
      };
      const body = (await res.json()) as {
        assets: Array<{
          symbol: string;
          assetClass: string;
          isFavorite: boolean;
          longEtfs: Link[];
          inverseEtfs: Link[];
        }>;
        sectors: Array<{
          etf: string;
          sectorName: string;
          isFavorite: boolean;
          inverseEtfs: Link[];
        }>;
      };

      expect(body.assets).toBeArrayOfSize(1);
      expect(body.assets[0]?.symbol).toBe("TSLA");
      expect(body.assets[0]?.assetClass).toBe("stock");
      expect(body.assets[0]?.longEtfs).toEqual([
        {
          symbol: "TSLL",
          name: "Direxion Daily TSLA Bull 2X Shares",
          relationType: "x2",
          multiplier: 2.0,
          isFavorite: false,
        },
      ]);
      expect(body.assets[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["TSLS"]);
      expect(body.assets[0]?.inverseEtfs[0]?.multiplier).toBe(-1.0);

      expect(body.sectors).toBeArrayOfSize(1);
      expect(body.sectors[0]).toEqual({
        etf: "XLK",
        sectorName: "Technology",
        isFavorite: false,
        inverseEtfs: [
          {
            symbol: "TECS",
            name: "Direxion Daily Technology Bear 3X Shares",
            relationType: "inverso",
            multiplier: -3.0,
            isFavorite: false,
          },
        ],
      });
    });

    it("503 si Supabase falla", async () => {
      mockFetch({ message: "error" }, 500);

      const res = await createApp().request(
        "/tickers/relations-overview",
        { headers: { Authorization: "Bearer token" } },
        ENV,
      );

      expect(res.status).toBe(503);
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
            relationType: "x2",
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
            relationType: "inverso",
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
            relationType: "x2",
            multiplier: 0.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("POST /admin/tickers/{id}/relations 422 previene signo inconsistente para inverso", async () => {
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
            relationType: "inverso",
            multiplier: 1.5,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });

    it("POST /admin/tickers/{id}/relations 422 previene signo inconsistente para leveraged (x2/x3)", async () => {
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
            relationType: "x2",
            multiplier: -2.0,
          }),
        },
        ENV,
      );

      expect(res.status).toBe(422);
    });
  });
});

// ---------------------------------------------------------------------------
// Favoritos por usuario (isFavorite + toggle)
// ---------------------------------------------------------------------------

const AUTH = { headers: { Authorization: "Bearer t" } };
const JSON_AUTH = {
  headers: { Authorization: "Bearer t", "content-type": "application/json" },
};

interface RoutedCfg {
  favorites?: Array<{ ticker: { symbol: string } }>;
  tickerLookup?: { id: number } | null;
  list?: unknown[];
  listCount?: number;
  detail?: unknown;
  overview?: unknown[];
}

/** Mock que rutea por tabla (auth + user_ticker_favorites + ticker_relations + tickers). */
function mockRouted(cfg: RoutedCfg) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });

    if (url.includes("/auth/v1/user")) {
      return jsonRes({ id: "uid-user", email: "user@example.com", app_metadata: { role: "user" } });
    }
    if (url.includes("user_ticker_favorites")) {
      if (method === "GET") return jsonRes(cfg.favorites ?? []);
      return jsonRes([]); // upsert / delete
    }
    if (url.includes("/rest/v1/ticker_relations")) {
      return jsonRes(cfg.overview ?? []);
    }
    if (url.includes("/rest/v1/tickers")) {
      if (url.includes("select=id") && url.includes("symbol=eq")) {
        return jsonRes(cfg.tickerLookup ?? null);
      }
      if (url.includes("symbol=eq")) {
        return jsonRes(cfg.detail ?? null);
      }
      const total = cfg.listCount ?? cfg.list?.length ?? 0;
      return jsonRes(cfg.list ?? [], 200, { "content-range": `0-0/${total}` });
    }
    return jsonRes([]);
  }) as unknown as typeof fetch;
}

describe("tickers favoritos", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("PUT /tickers/{symbol}/favorite → 200 { favorite: true }", async () => {
    mockRouted({ tickerLookup: { id: 1 } });
    const res = await createApp().request(
      "/tickers/TSLA/favorite",
      { ...JSON_AUTH, method: "PUT" },
      ENV,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { favorite: boolean }).toEqual({ favorite: true });
  });

  it("PUT /tickers/{symbol}/favorite con símbolo inexistente → 404", async () => {
    mockRouted({ tickerLookup: null });
    const res = await createApp().request(
      "/tickers/NOPE/favorite",
      { ...JSON_AUTH, method: "PUT" },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /tickers/{symbol}/favorite → 200 { favorite: false }", async () => {
    mockRouted({ tickerLookup: { id: 1 } });
    const res = await createApp().request(
      "/tickers/TSLA/favorite",
      { ...AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { favorite: boolean }).toEqual({ favorite: false });
  });

  it("DELETE /tickers/{symbol}/favorite con símbolo inexistente → 200 (idempotente)", async () => {
    mockRouted({ tickerLookup: null });
    const res = await createApp().request(
      "/tickers/NOPE/favorite",
      { ...AUTH, method: "DELETE" },
      ENV,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { favorite: boolean }).toEqual({ favorite: false });
  });

  it("GET /tickers?favorite=true → filtra el listado a los favoritos del usuario", async () => {
    mockRouted({
      favorites: [{ ticker: { symbol: "TSLA" } }],
      list: [{ ...TICKER_RAW_ROW, id: 1, symbol: "TSLA" }],
      listCount: 1,
    });
    const res = await createApp().request("/tickers?favorite=true", AUTH, ENV);
    expect(res.status).toBe(200);
    // El listado se filtra en la DB por los símbolos favoritos (symbol=in.(...)).
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => decodeURIComponent(String(c[0])),
    );
    const listCall = calls.find((u) => u.includes("/rest/v1/tickers?") && u.includes("symbol=in."));
    expect(listCall).toBeDefined();
    expect(listCall).toContain("TSLA");
    const body = (await res.json()) as { tickers: Array<{ isFavorite: boolean }> };
    expect(body.tickers.every((t) => t.isFavorite)).toBe(true);
  });

  it("GET /tickers?favorite=true sin favoritos → lista vacía sin pegarle al catálogo", async () => {
    mockRouted({ favorites: [], list: [{ ...TICKER_RAW_ROW }], listCount: 5 });
    const res = await createApp().request("/tickers?favorite=true", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickers: unknown[]; pagination: { total: number } };
    expect(body.tickers).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("GET /tickers → cada activo trae isFavorite según los favoritos del usuario", async () => {
    mockRouted({
      favorites: [{ ticker: { symbol: "TSLA" } }],
      list: [
        { ...TICKER_RAW_ROW, id: 1, symbol: "TSLA" },
        { ...TICKER_RAW_ROW, id: 2, symbol: "AAPL" },
      ],
      listCount: 2,
    });
    const res = await createApp().request("/tickers", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tickers: Array<{ symbol: string; isFavorite: boolean }>;
    };
    const bySymbol = Object.fromEntries(body.tickers.map((t) => [t.symbol, t.isFavorite]));
    expect(bySymbol.TSLA).toBe(true);
    expect(bySymbol.AAPL).toBe(false);
  });

  it("GET /tickers/{symbol} → isFavorite en el activo y en sus relaciones", async () => {
    mockRouted({
      favorites: [{ ticker: { symbol: "TSLA" } }, { ticker: { symbol: "TSLL" } }],
      detail: {
        ...TICKER_RAW_ROW,
        id: 1,
        symbol: "TSLA",
        ticker_relations: [
          {
            relation_type: "x2",
            multiplier: "2.00",
            related_ticker: { symbol: "TSLL", name: "Direxion Daily TSLA Bull 2X Shares" },
          },
          {
            relation_type: "inverso",
            multiplier: "-1.00",
            related_ticker: { symbol: "TSLS", name: "Direxion Daily TSLA Bear 1X Shares" },
          },
        ],
        investep_plan_tickers: [],
      },
    });
    const res = await createApp().request("/tickers/TSLA", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      symbol: string;
      isFavorite: boolean;
      relations: Array<{ symbol: string; isFavorite: boolean }>;
    };
    expect(body.isFavorite).toBe(true);
    const rel = Object.fromEntries(body.relations.map((r) => [r.symbol, r.isFavorite]));
    expect(rel.TSLL).toBe(true);
    expect(rel.TSLS).toBe(false);
  });

  it("GET /tickers/relations-overview → isFavorite en activos y ETFs", async () => {
    mockRouted({
      favorites: [{ ticker: { symbol: "TSLA" } }, { ticker: { symbol: "TSLL" } }],
      overview: [
        {
          relation_type: "x2",
          multiplier: "2.00",
          parent: { symbol: "TSLA", name: "Tesla, Inc.", asset_class: "stock", sector: "Cyclical" },
          related: { symbol: "TSLL", name: "Direxion Daily TSLA Bull 2X Shares" },
        },
        {
          relation_type: "inverso",
          multiplier: "-1.00",
          parent: { symbol: "TSLA", name: "Tesla, Inc.", asset_class: "stock", sector: "Cyclical" },
          related: { symbol: "TSLS", name: "Direxion Daily TSLA Bear 1X Shares" },
        },
      ],
    });
    const res = await createApp().request("/tickers/relations-overview", AUTH, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assets: Array<{
        symbol: string;
        isFavorite: boolean;
        longEtfs: Array<{ symbol: string; isFavorite: boolean }>;
        inverseEtfs: Array<{ symbol: string; isFavorite: boolean }>;
      }>;
    };
    const tsla = body.assets.find((a) => a.symbol === "TSLA");
    expect(tsla?.isFavorite).toBe(true);
    expect(tsla?.longEtfs.find((e) => e.symbol === "TSLL")?.isFavorite).toBe(true);
    expect(tsla?.inverseEtfs.find((e) => e.symbol === "TSLS")?.isFavorite).toBe(false);
  });
});
