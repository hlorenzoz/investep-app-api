/**
 * Schema de validación (Zod) para el manifiesto externo `scripts/data/tienda-products.json`.
 *
 * Espeja los refines de `CreateProductSchema` (`src/features/products/products.routes.ts`)
 * pero sobre las claves SNAKE_CASE del JSON (`amazon_url` en vez de `amazonUrl`): el JSON es
 * el formato editable a mano por no-programadores, así que se mantiene snake_case = columnas
 * de la DB, no camelCase de la API. Módulo separado y puro (sin I/O) para ser testeable sin
 * mocks (`tests/populate-tienda.test.ts`) — Extract-Before-Mock Rule del módulo TDD.
 */
import { z } from "zod";

const CategoryEnum = z.enum(["book", "tshirt", "cap"]);
const GenderEnum = z.enum(["men", "women"]);
const ThemeEnum = z.enum(["light", "dark"]);

export const SeedProductSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo."),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    category: CategoryEnum,
    gender: GenderEnum.nullable().optional(),
    theme: ThemeEnum.nullable().optional(),
    price: z.number().positive().nullable().optional(),
    currency: z.string().min(1).optional(),
    amazon_url: z
      .string()
      .url()
      .regex(/^https?:\/\//, "El enlace de Amazon debe ser una URL http(s).")
      .nullable()
      .optional(),
    image: z.string().min(1),
    active: z.boolean().optional(),
  })
  .refine((data) => data.price != null || data.amazon_url != null, {
    message: "Definí un precio o un enlace de Amazon (al menos uno).",
    path: ["price"],
  })
  .refine((data) => data.category === "tshirt" || (data.gender == null && data.theme == null), {
    message: "gender/theme solo aplican a la categoría 'tshirt'.",
    path: ["gender"],
  });

export type SeedProduct = z.infer<typeof SeedProductSchema>;

/**
 * Valida cada entrada del manifiesto. Falla RUIDOSAMENTE (throw) apenas encuentra la primera
 * entrada inválida, identificando su `slug` en el mensaje — no siembra parcialmente.
 */
export function validateSeedProducts(entries: unknown[]): SeedProduct[] {
  const results: SeedProduct[] = [];
  for (const entry of entries) {
    const parsed = SeedProductSchema.safeParse(entry);
    if (!parsed.success) {
      const slug = (entry as { slug?: unknown })?.slug;
      throw new Error(
        `Producto inválido (slug="${String(slug)}"): ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    results.push(parsed.data);
  }
  return results;
}
