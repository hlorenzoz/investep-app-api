import { z } from "zod";

export const SeedRecommendedBookSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]+$/, "Solo minúsculas, números, guion y guion bajo."),
  title: z.string().min(1),
  author: z.string().min(1),
  description: z.string().min(1),
  url: z
    .string()
    .url()
    .regex(/^https?:\/\//, "La URL del libro debe ser http(s)."),
  image: z.string().min(1),
  sort_order: z.number().int().nonnegative(),
});

export type SeedRecommendedBook = z.infer<typeof SeedRecommendedBookSchema>;

export function validateSeedRecommendedBooks(entries: unknown[]): SeedRecommendedBook[] {
  const results: SeedRecommendedBook[] = [];
  for (const entry of entries) {
    const parsed = SeedRecommendedBookSchema.safeParse(entry);
    if (!parsed.success) {
      const slug = (entry as { slug?: unknown })?.slug;
      throw new Error(
        `Libro inválido (slug="${String(slug)}"): ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    results.push(parsed.data);
  }
  return results;
}
