import { describe, expect, it } from "bun:test";
import {
  buildRelationsOverview,
  mapRelationLink,
  type OverviewRelationRow,
} from "./tickers.service";

/** Helper para construir una fila cruda de la query agregada de relaciones. */
function rel(
  parent: { symbol: string; name?: string; assetClass: string; sector?: string | null },
  related: { symbol: string; name?: string },
  relationType: string,
  multiplier: number,
): OverviewRelationRow {
  return {
    relation_type: relationType,
    multiplier: String(multiplier.toFixed(2)),
    parent: {
      symbol: parent.symbol,
      name: parent.name ?? `${parent.symbol} Name`,
      asset_class: parent.assetClass,
      sector: parent.sector ?? null,
    },
    related: { symbol: related.symbol, name: related.name ?? `${related.symbol} Name` },
  };
}

describe("mapRelationLink", () => {
  it("mapea tipo, nombre, símbolo y coerciona el multiplier string con signo", () => {
    expect(mapRelationLink("inverso", "-3.00", { symbol: "TECS", name: "Tech Bear 3X" })).toEqual({
      symbol: "TECS",
      name: "Tech Bear 3X",
      relationType: "inverso",
      multiplier: -3.0,
    });
  });

  it("acepta multiplier numérico", () => {
    expect(mapRelationLink("x2", 2, { symbol: "TSLL", name: "TSLA Bull 2X" }).multiplier).toBe(2.0);
  });

  it("cae a strings vacíos si el ticker relacionado es null", () => {
    expect(mapRelationLink("x2", "1.00", null)).toEqual({
      symbol: "",
      name: "",
      relationType: "x2",
      multiplier: 1.0,
    });
  });
});

describe("buildRelationsOverview — assets", () => {
  it("agrupa por activo padre y separa longEtfs de inverseEtfs", () => {
    const { assets } = buildRelationsOverview([
      rel({ symbol: "TSLA", assetClass: "stock" }, { symbol: "TSLL" }, "x2", 2.0),
      rel({ symbol: "TSLA", assetClass: "stock" }, { symbol: "TSLS" }, "inverso", -1.0),
    ]);

    expect(assets).toBeArrayOfSize(1);
    expect(assets[0]?.symbol).toBe("TSLA");
    expect(assets[0]?.assetClass).toBe("stock");
    expect(assets[0]?.longEtfs.map((e) => e.symbol)).toEqual(["TSLL"]);
    expect(assets[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["TSLS"]);
    expect(assets[0]?.longEtfs[0]).toEqual({
      symbol: "TSLL",
      name: "TSLL Name",
      relationType: "x2",
      multiplier: 2.0,
    });
    expect(assets[0]?.inverseEtfs[0]?.multiplier).toBe(-1.0);
  });

  it("incluye índices (assetClass index) y ordena arrays por ABS(multiplier) asc y luego por symbol", () => {
    const { assets } = buildRelationsOverview([
      rel({ symbol: "SPX", assetClass: "index" }, { symbol: "SPXU" }, "inverso", -3.0),
      rel({ symbol: "SPX", assetClass: "index" }, { symbol: "SH" }, "inverso", -1.0),
      rel({ symbol: "SPX", assetClass: "index" }, { symbol: "SPXS" }, "inverso", -3.0),
      rel({ symbol: "SPX", assetClass: "index" }, { symbol: "SDS" }, "inverso", -2.0),
    ]);

    expect(assets[0]?.assetClass).toBe("index");
    // ABS asc: 1 (SH), 2 (SDS), 3 (SPXS, SPXU → desempate por symbol)
    expect(assets[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["SH", "SDS", "SPXS", "SPXU"]);
  });

  it("ordena el array de assets por symbol asc", () => {
    const { assets } = buildRelationsOverview([
      rel({ symbol: "TSLA", assetClass: "stock" }, { symbol: "TSLL" }, "x2", 2.0),
      rel({ symbol: "AAPL", assetClass: "stock" }, { symbol: "AAPU" }, "x2", 2.0),
      rel({ symbol: "NVDA", assetClass: "stock" }, { symbol: "NVDL" }, "x2", 2.0),
    ]);
    expect(assets.map((a) => a.symbol)).toEqual(["AAPL", "NVDA", "TSLA"]);
  });

  it("clasifica como inverse cualquier relación con multiplier negativo aunque el tipo no sea 'inverso'", () => {
    const { assets } = buildRelationsOverview([
      rel({ symbol: "RUT", assetClass: "index" }, { symbol: "TNA" }, "x3", 3.0),
      rel({ symbol: "RUT", assetClass: "index" }, { symbol: "TZA" }, "x3", -3.0),
    ]);
    expect(assets[0]?.longEtfs.map((e) => e.symbol)).toEqual(["TNA"]);
    expect(assets[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["TZA"]);
  });

  it("no incluye ETFs (asset_class etf) como activos base", () => {
    const { assets } = buildRelationsOverview([
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECS" },
        "inverso",
        -3.0,
      ),
    ]);
    expect(assets).toBeArrayOfSize(0);
  });
});

describe("buildRelationsOverview — sectors", () => {
  it("agrupa ETFs sectoriales (etf + sector) por sus relaciones inverse", () => {
    const { sectors } = buildRelationsOverview([
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECS" },
        "inverso",
        -3.0,
      ),
    ]);
    expect(sectors).toBeArrayOfSize(1);
    expect(sectors[0]).toEqual({
      etf: "XLK",
      sectorName: "Technology",
      inverseEtfs: [
        { symbol: "TECS", name: "TECS Name", relationType: "inverso", multiplier: -3.0 },
      ],
    });
  });

  it("ordena los sectores por sectorName asc", () => {
    const { sectors } = buildRelationsOverview([
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECS" },
        "inverso",
        -3.0,
      ),
      rel(
        { symbol: "XLE", assetClass: "etf", sector: "Energy" },
        { symbol: "ERY" },
        "inverso",
        -2.0,
      ),
      rel(
        { symbol: "XLF", assetClass: "etf", sector: "Financial" },
        { symbol: "FAZ" },
        "inverso",
        -3.0,
      ),
    ]);
    expect(sectors.map((s) => s.sectorName)).toEqual(["Energy", "Financial", "Technology"]);
  });

  it("excluye relaciones no inversas de los sectores", () => {
    const { sectors } = buildRelationsOverview([
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECS" },
        "inverso",
        -3.0,
      ),
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECL" },
        "x3",
        3.0,
      ),
    ]);
    expect(sectors[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["TECS"]);
  });

  it("agrupa el ETF de real estate XLRE (símbolo SPDR correcto) con su ETF inverso", () => {
    const { sectors } = buildRelationsOverview([
      rel(
        { symbol: "XLRE", assetClass: "etf", sector: "Real Estate" },
        { symbol: "DRV" },
        "inverso",
        -3.0,
      ),
    ]);
    expect(sectors[0]?.etf).toBe("XLRE");
    expect(sectors[0]?.sectorName).toBe("Real Estate");
    expect(sectors[0]?.inverseEtfs.map((e) => e.symbol)).toEqual(["DRV"]);
  });

  it("no incluye ETFs sin sector aunque tengan relación inversa", () => {
    const { sectors } = buildRelationsOverview([
      rel({ symbol: "SPY", assetClass: "etf", sector: null }, { symbol: "SH" }, "inverso", -1.0),
    ]);
    expect(sectors).toBeArrayOfSize(0);
  });

  it("no incluye ETFs sectoriales cuyas relaciones sean todas long", () => {
    const { sectors } = buildRelationsOverview([
      rel(
        { symbol: "XLK", assetClass: "etf", sector: "Technology" },
        { symbol: "TECL" },
        "x3",
        3.0,
      ),
    ]);
    expect(sectors).toBeArrayOfSize(0);
  });
});

describe("buildRelationsOverview — vacío", () => {
  it("devuelve arrays vacíos sin relaciones", () => {
    expect(buildRelationsOverview([])).toEqual({ assets: [], sectors: [] });
  });

  it("ignora filas con parent o related nulos", () => {
    const overview = buildRelationsOverview([
      {
        relation_type: "x2",
        multiplier: "2.00",
        parent: null,
        related: { symbol: "X", name: "X" },
      },
      {
        relation_type: "x2",
        multiplier: "2.00",
        parent: { symbol: "TSLA", name: "Tesla", asset_class: "stock", sector: null },
        related: null,
      },
    ]);
    expect(overview).toEqual({ assets: [], sectors: [] });
  });
});
