import { describe, expect, it } from "bun:test";
import {
  CreateProductSchema,
  ListProductsQuerySchema,
  UpdateProductSchema,
} from "./products.routes";

const BOOK_BASE = {
  slug: "libro-invertir-con-cabeza",
  name: "Invertir con Cabeza",
  category: "book" as const,
};

const TSHIRT_BASE = {
  slug: "remera-toro-dark",
  name: "Remera Toro Dark",
  category: "tshirt" as const,
};

describe("CreateProductSchema · regla precio-o-amazon (al menos uno)", () => {
  it("éxito: solo price definido", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, price: 19.99 });
    expect(r.success).toBe(true);
  });

  it("éxito: solo amazonUrl definido", () => {
    const r = CreateProductSchema.safeParse({
      ...BOOK_BASE,
      amazonUrl: "https://amazon.com/dp/XXXX",
    });
    expect(r.success).toBe(true);
  });

  it("falla: ni price ni amazonUrl", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE });
    expect(r.success).toBe(false);
  });

  it("falla: amazonUrl con esquema no-http (ftp://) — debe ser http(s)", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, amazonUrl: "ftp://example.com/x" });
    expect(r.success).toBe(false);
  });

  it("éxito: amazonUrl http", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, amazonUrl: "http://amazon.com/dp/X" });
    expect(r.success).toBe(true);
  });
});

describe("CreateProductSchema · variantes tipadas (gender/theme solo tshirt)", () => {
  it("éxito: tshirt con gender + theme", () => {
    const r = CreateProductSchema.safeParse({
      ...TSHIRT_BASE,
      price: 29.99,
      gender: "women",
      theme: "dark",
    });
    expect(r.success).toBe(true);
  });

  it("falla: book con gender seteado", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, price: 19.99, gender: "men" });
    expect(r.success).toBe(false);
  });

  it("falla: cap con theme seteado", () => {
    const r = CreateProductSchema.safeParse({
      slug: "gorra-investep",
      name: "Gorra Investep",
      category: "cap",
      price: 15,
      theme: "light",
    });
    expect(r.success).toBe(false);
  });
});

describe("UpdateProductSchema · PATCH parcial", () => {
  it("éxito: patch parcial tocando solo name no dispara los refines", () => {
    const r = UpdateProductSchema.safeParse({ name: "Nuevo nombre" });
    expect(r.success).toBe(true);
  });

  it("falla: patch que borra price Y amazonUrl a la vez", () => {
    const r = UpdateProductSchema.safeParse({ price: null, amazonUrl: null });
    expect(r.success).toBe(false);
  });

  it("éxito: patch que setea category=tshirt junto con gender", () => {
    const r = UpdateProductSchema.safeParse({ category: "tshirt", gender: "men" });
    expect(r.success).toBe(true);
  });

  it("éxito (limitación conocida): patch que solo setea gender sin tocar category se permite a nivel Zod", () => {
    // El CHECK de la DB (products_typed_variant_check) es el guard real para este caso —
    // un PATCH que deja category=book intacto pero agrega gender solo se detecta en la DB,
    // no en este refine parcial (ver ADR-4 de design.md). Documentado, no es un bug.
    const r = UpdateProductSchema.safeParse({ gender: "men" });
    expect(r.success).toBe(true);
  });

  it("REGRESIÓN: un patch parcial NO reinyecta los defaults de currency/active (partial() + default() de Zod)", () => {
    // `.partial()` sobre un campo `.optional().default(...)` puede reinyectar el default
    // cuando la clave está ausente si el default vive en el schema base compartido con
    // Create. Esto rompería el contrato "PATCH solo toca los campos enviados": un
    // `PATCH {name: "x"}` NO debe resetear `currency` a "USD" ni `active` a `true`.
    const r = UpdateProductSchema.parse({ name: "Nuevo nombre" });
    expect(r).not.toHaveProperty("currency");
    expect(r).not.toHaveProperty("active");
  });

  it("REGRESIÓN: un patch totalmente vacío queda como objeto vacío (sin defaults)", () => {
    const r = UpdateProductSchema.parse({});
    expect(Object.keys(r)).toHaveLength(0);
  });
});

describe("ListProductsQuerySchema", () => {
  it("coerciona active=true a boolean true", () => {
    const r = ListProductsQuerySchema.parse({ active: "true" });
    expect(r.active).toBe(true);
  });

  it("coerciona active=false a boolean false", () => {
    const r = ListProductsQuerySchema.parse({ active: "false" });
    expect(r.active).toBe(false);
  });

  it("category inválida es rechazada", () => {
    const r = ListProductsQuerySchema.safeParse({ category: "shoes" });
    expect(r.success).toBe(false);
  });
});

describe("SlugSchema (vía CreateProductSchema)", () => {
  it("rechaza mayúsculas", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, slug: "Bad-Slug", price: 19.99 });
    expect(r.success).toBe(false);
  });

  it("rechaza espacios", () => {
    const r = CreateProductSchema.safeParse({ ...BOOK_BASE, slug: "bad slug", price: 19.99 });
    expect(r.success).toBe(false);
  });
});
