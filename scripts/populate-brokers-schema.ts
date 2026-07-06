import { z } from "zod";

export const SeedBrokerSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo."),
  name: z.string().min(1),
  url: z
    .string()
    .url()
    .regex(/^https?:\/\//, "La URL del bróker debe ser http(s)."),
  url_secondary: z
    .string()
    .url()
    .regex(/^https?:\/\//, "La URL secundaria del bróker debe ser http(s).")
    .nullable()
    .optional(),
  logo: z.string().nullable().optional(),
  favicon: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
});

export type SeedBroker = z.infer<typeof SeedBrokerSchema>;

export function validateSeedBrokers(entries: unknown[]): SeedBroker[] {
  const results: SeedBroker[] = [];
  for (const entry of entries) {
    const parsed = SeedBrokerSchema.safeParse(entry);
    if (!parsed.success) {
      const slug = (entry as { slug?: unknown })?.slug;
      throw new Error(
        `Bróker inválido (slug="${String(slug)}"): ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    results.push(parsed.data);
  }
  return results;
}
