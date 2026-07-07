import { describe, expect, it } from "bun:test";
import { validateSeedRecommendedBooks } from "../scripts/populate-recommended-books-schema";

const BOOK = {
  slug: "habitos-atomicos",
  title: "Hábitos atómicos",
  author: "James Clear",
  description:
    "Un enfoque práctico sobre cómo los pequeños hábitos diarios generan grandes cambios.",
  url: "https://www.youtube.com/results?search_query=habitos+atomicos+audiolibro+espanol",
  image: "books/habitos-atomicos.webp",
  sort_order: 12,
};

describe("validateSeedRecommendedBooks · campos requeridos", () => {
  it("acepta un libro válido completo", () => {
    expect(() => validateSeedRecommendedBooks([{ ...BOOK }])).not.toThrow();
  });

  it("rechaza sin title, identificando el slug ofensor", () => {
    const { title: _title, ...rest } = BOOK;
    expect(() => validateSeedRecommendedBooks([rest])).toThrow(/habitos-atomicos/);
  });

  it("rechaza sin author, identificando el slug ofensor", () => {
    const { author: _author, ...rest } = BOOK;
    expect(() => validateSeedRecommendedBooks([rest])).toThrow(/habitos-atomicos/);
  });

  it("rechaza sin description, identificando el slug ofensor", () => {
    const { description: _description, ...rest } = BOOK;
    expect(() => validateSeedRecommendedBooks([rest])).toThrow(/habitos-atomicos/);
  });

  it("rechaza sin image, identificando el slug ofensor", () => {
    const { image: _image, ...rest } = BOOK;
    expect(() => validateSeedRecommendedBooks([rest])).toThrow(/habitos-atomicos/);
  });

  it("rechaza un slug con mayúsculas, identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, slug: "Bad-Slug" }];
    expect(() => validateSeedRecommendedBooks(entries)).toThrow(/Bad-Slug/);
  });
});

describe("validateSeedRecommendedBooks · URL http(s)", () => {
  it("rechaza una url no-http (ftp://), identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, url: "ftp://example.com/x" }];
    expect(() => validateSeedRecommendedBooks(entries)).toThrow(/habitos-atomicos/);
  });

  it("rechaza una url que no es URL válida", () => {
    const entries = [{ ...BOOK, url: "no-es-una-url" }];
    expect(() => validateSeedRecommendedBooks(entries)).toThrow(/habitos-atomicos/);
  });
});

describe("validateSeedRecommendedBooks · sort_order", () => {
  it("rechaza un sort_order negativo, identificando el slug ofensor", () => {
    const entries = [{ ...BOOK, sort_order: -1 }];
    expect(() => validateSeedRecommendedBooks(entries)).toThrow(/habitos-atomicos/);
  });

  it("rechaza un sort_order no entero", () => {
    const entries = [{ ...BOOK, sort_order: 1.5 }];
    expect(() => validateSeedRecommendedBooks(entries)).toThrow(/habitos-atomicos/);
  });
});

describe("validateSeedRecommendedBooks · manifiesto real", () => {
  it("el archivo scripts/data/books.json completo es válido", async () => {
    const data = (await import("../scripts/data/books.json")) as unknown as {
      default: unknown[];
    };
    const entries = Array.isArray(data) ? data : data.default;
    const result = validateSeedRecommendedBooks(entries as unknown[]);
    expect(result.length).toBe(18);

    const slugs = result.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(18);

    const orders = result.map((b) => b.sort_order);
    expect(new Set(orders).size).toBe(18);
  });
});
