import { readFileSync } from "node:fs";
import { loadDevVars, makeAdminFromVars } from "./_env";
import { validateSeedRecommendedBooks } from "./populate-recommended-books-schema";

const DATA_PATH = new URL("./data/books.json", import.meta.url);

const args = process.argv.slice(2);
let envName: string | undefined;
const envFlagIdx = args.indexOf("--env");
if (envFlagIdx !== -1 && args[envFlagIdx + 1]) {
  envName = args[envFlagIdx + 1];
  args.splice(envFlagIdx, 2);
}
if (!envName && args[0]) envName = args[0];
if (envName === "") envName = undefined;

const vars = loadDevVars(envName);

async function main(): Promise<void> {
  const admin = makeAdminFromVars(vars);

  const raw = readFileSync(DATA_PATH, "utf8");
  const entries: unknown[] = JSON.parse(raw);
  const books = validateSeedRecommendedBooks(entries);

  const rows = books.map((b) => ({
    slug: b.slug,
    title: b.title,
    author: b.author,
    description: b.description,
    url: b.url,
    image: b.image,
    sort_order: b.sort_order,
  }));

  const { data, error } = await admin
    .from("recommended_books")
    .upsert(rows, { onConflict: "slug" })
    .select("slug");
  if (error) throw new Error(`Error al sembrar libros recomendados: ${error.message}`);

  console.log(
    JSON.stringify({
      env: envName ?? "local",
      total: rows.length,
      slugs: (data ?? []).map((r) => r.slug),
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Error inesperado.");
  process.exit(1);
});
