/**
 * CLI: siembra/actualiza el catálogo de la tienda desde el manifiesto editable
 * `scripts/data/tienda-products.json` (NO hardcodeado en el script — a diferencia de
 * `EQUITY_OPS`/`create-users-by-plan.ts`, este es un archivo JSON aparte pensado para que
 * alguien sin conocimientos de programación pueda editar precios/links de Amazon).
 *
 * Uso:
 *   bun run scripts/populate-tienda.ts [ENV]     // ENV: "" (local) | staging | production
 *   just populate-tienda
 *   just populate-tienda staging
 *
 * Valida CADA entrada del JSON contra `SeedProductSchema` (ver `populate-tienda-schema.ts`)
 * ANTES de escribir nada: si una sola entrada es inválida, falla ruidosamente identificando
 * su `slug` y NO siembra nada (todo o nada). Idempotente: upsert por `slug` (columna única).
 * Imprime un resumen JSON con la cantidad de filas afectadas.
 */
import { readFileSync } from "node:fs";
import { loadDevVars, makeAdminFromVars } from "./_env";
import { validateSeedProducts } from "./populate-tienda-schema";

const DATA_PATH = new URL("./data/tienda-products.json", import.meta.url);

// ---------------------------------------------------------------------------
// Parseo de argumentos (ENV opcional: posicional o --env <nombre>)
// ---------------------------------------------------------------------------

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
  const products = validateSeedProducts(entries);

  const rows = products.map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description ?? null,
    category: p.category,
    gender: p.gender ?? null,
    theme: p.theme ?? null,
    price: p.price ?? null,
    currency: p.currency ?? "USD",
    amazon_url: p.amazon_url ?? null,
    image: p.image,
    active: p.active ?? true,
  }));

  const { data, error } = await admin
    .from("products")
    .upsert(rows, { onConflict: "slug" })
    .select("slug");
  if (error) throw new Error(`Error al sembrar productos: ${error.message}`);

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
