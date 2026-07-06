import { describe, expect, it } from "bun:test";
import { validateSeedProducts } from "../scripts/populate-tienda-schema";

const BOOK = {
  slug: "libro-x",
  name: "Libro X",
  category: "book" as const,
  price: 19.99,
  image: "store/ebooks/x.webp",
};

describe("validateSeedProducts · category enum", () => {
  it("acepta book/tshirt/cap", () => {
    const entries = [
      { ...BOOK, category: "book" },
      { ...BOOK, slug: "gorra-x", category: "cap" },
      {
        ...BOOK,
        slug: "remera-x",
        category: "tshirt",
        gender: "men",
        theme: "dark",
      },
    ];
    expect(() => validateSeedProducts(entries)).not.toThrow();
  });

  it("rechaza una categoría fuera del enum, identificando el slug", () => {
    const entries = [{ ...BOOK, category: "shoes" }];
    expect(() => validateSeedProducts(entries)).toThrow(/libro-x/);
  });
});

describe("validateSeedProducts · precio-o-amazon (al menos uno)", () => {
  it("acepta solo price", () => {
    expect(() => validateSeedProducts([{ ...BOOK, price: 19.99, amazon_url: null }])).not.toThrow();
  });

  it("acepta solo amazon_url", () => {
    expect(() =>
      validateSeedProducts([{ ...BOOK, price: null, amazon_url: "https://amazon.com/dp/XXXX" }]),
    ).not.toThrow();
  });

  it("rechaza cuando faltan ambos, identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, price: null, amazon_url: null }];
    expect(() => validateSeedProducts(entries)).toThrow(/libro-x/);
  });

  it("rechaza un amazon_url no-http (ftp://), identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, price: null, amazon_url: "ftp://example.com/x" }];
    expect(() => validateSeedProducts(entries)).toThrow(/libro-x/);
  });
});

describe("validateSeedProducts · variantes tipadas (gender/theme solo tshirt)", () => {
  it("acepta tshirt con gender+theme", () => {
    const entries = [
      { ...BOOK, slug: "remera-y", category: "tshirt", gender: "women", theme: "light" },
    ];
    expect(() => validateSeedProducts(entries)).not.toThrow();
  });

  it("rechaza gender en un book, identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, slug: "libro-invalido", gender: "men" }];
    expect(() => validateSeedProducts(entries)).toThrow(/libro-invalido/);
  });

  it("rechaza theme en un cap, identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, slug: "gorra-invalida", category: "cap", theme: "dark" }];
    expect(() => validateSeedProducts(entries)).toThrow(/gorra-invalida/);
  });
});

describe("validateSeedProducts · manifiesto real", () => {
  it("el archivo scripts/data/tienda-products.json completo es válido", async () => {
    const data = (await import("../scripts/data/tienda-products.json")) as unknown as {
      default: unknown[];
    };
    const entries = Array.isArray(data) ? data : data.default;
    const result = validateSeedProducts(entries as unknown[]);
    expect(result.length).toBe(16);
  });
});
