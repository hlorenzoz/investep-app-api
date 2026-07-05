import { describe, expect, it, mock } from "bun:test";
import {
  type ProjectionCacheKey,
  projectionCacheKey,
  readProjectionCache,
  writeProjectionCache,
} from "./projections.cache";

const KEY: ProjectionCacheKey = {
  accountType: "equity",
  ratePct: 25,
  baseAmount: 15000,
  startDate: new Date("2026-07-01T00:00:00.000Z"),
  grouping: "monthly",
};

describe("projectionCacheKey", () => {
  it("es determinístico e incluye los determinantes de la serie + la versión", () => {
    expect(projectionCacheKey(KEY)).toBe("proj:v2:equity:25:15000:2026-07-01:monthly:def");
  });

  it("mismos inputs → misma clave (idempotente para el cache)", () => {
    expect(projectionCacheKey(KEY)).toBe(projectionCacheKey({ ...KEY }));
  });

  it("años explícitos entran en la clave; ausentes → 'def'", () => {
    expect(projectionCacheKey({ ...KEY, years: 5 })).toBe(
      "proj:v2:equity:25:15000:2026-07-01:monthly:5",
    );
    expect(projectionCacheKey({ ...KEY, years: undefined })).toContain(":def");
  });

  it("solo usa la fecha (no la hora) del startDate", () => {
    const withTime = { ...KEY, startDate: new Date("2026-07-01T18:30:00.000Z") };
    expect(projectionCacheKey(withTime)).toBe(projectionCacheKey(KEY));
  });

  it("distinta tasa / tipo / grouping / baseAmount → distinta clave (evita servir serie vieja)", () => {
    const base = projectionCacheKey(KEY);
    expect(projectionCacheKey({ ...KEY, ratePct: 30 })).not.toBe(base);
    expect(projectionCacheKey({ ...KEY, accountType: "options" })).not.toBe(base);
    expect(projectionCacheKey({ ...KEY, grouping: "daily" })).not.toBe(base);
    expect(projectionCacheKey({ ...KEY, baseAmount: 15001 })).not.toBe(base);
  });
});

describe("readProjectionCache — acceso defensivo", () => {
  it("kv nulo/undefined → null (no rompe)", async () => {
    expect(await readProjectionCache(null, "k")).toBeNull();
    expect(await readProjectionCache(undefined, "k")).toBeNull();
  });

  it("binding sin get (p. ej. el {} de los tests) → null", async () => {
    expect(await readProjectionCache({} as never, "k")).toBeNull();
  });

  it("hit: devuelve el valor guardado", async () => {
    const kv = { get: mock(async () => "cached-body"), put: mock(async () => {}) };
    expect(await readProjectionCache(kv as never, "k")).toBe("cached-body");
    expect(kv.get).toHaveBeenCalledWith("k");
  });

  it("miss: get devuelve null → null", async () => {
    const kv = { get: mock(async () => null), put: mock(async () => {}) };
    expect(await readProjectionCache(kv as never, "k")).toBeNull();
  });

  it("get que lanza → degrada a null (no propaga)", async () => {
    const kv = {
      get: mock(async () => {
        throw new Error("kv down");
      }),
      put: mock(async () => {}),
    };
    expect(await readProjectionCache(kv as never, "k")).toBeNull();
  });
});

describe("writeProjectionCache — acceso defensivo", () => {
  it("kv nulo / sin put → no-op sin lanzar", async () => {
    await expect(writeProjectionCache(null, "k", "v")).resolves.toBeUndefined();
    await expect(writeProjectionCache({} as never, "k", "v")).resolves.toBeUndefined();
  });

  it("happy: escribe con la clave, el body y un TTL", async () => {
    const put = mock(async () => {});
    const kv = { get: mock(async () => null), put };
    await writeProjectionCache(kv as never, "k", "body");
    expect(put).toHaveBeenCalledTimes(1);
    const [key, body, opts] = put.mock.calls[0] as unknown as [
      string,
      string,
      { expirationTtl: number },
    ];
    expect(key).toBe("k");
    expect(body).toBe("body");
    expect(opts.expirationTtl).toBeGreaterThan(0);
  });

  it("put que lanza → best-effort, no propaga", async () => {
    const kv = {
      get: mock(async () => null),
      put: mock(async () => {
        throw new Error("kv full");
      }),
    };
    await expect(writeProjectionCache(kv as never, "k", "v")).resolves.toBeUndefined();
  });
});
