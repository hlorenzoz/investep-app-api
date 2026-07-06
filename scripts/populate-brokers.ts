import { readFileSync } from "node:fs";
import { loadDevVars, makeAdminFromVars } from "./_env";
import { validateSeedBrokers } from "./populate-brokers-schema";

const DATA_PATH = new URL("./data/brokers.json", import.meta.url);

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
  const brokers = validateSeedBrokers(entries);

  const rows = brokers.map((b) => ({
    slug: b.slug,
    name: b.name,
    url: b.url,
    url_secondary: b.url_secondary ?? null,
    logo: b.logo ?? null,
    favicon: b.favicon ?? null,
    icon: b.icon ?? null,
  }));

  const { data, error } = await admin
    .from("brokers")
    .upsert(rows, { onConflict: "slug" })
    .select("slug");
  if (error) throw new Error(`Error al sembrar brokers: ${error.message}`);

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
