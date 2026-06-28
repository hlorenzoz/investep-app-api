import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadDevVars } from "../scripts/_env";

/**
 * E2E del módulo academy contra la API real + Supabase local.
 *
 * Lo que los tests de integración (que mockean PostgREST) NO pueden verificar: que el
 * `select=` con EMBEDDING ANIDADO a través de la junction M:N
 * (`investep_plan_features(investep_features(...investep_feature_translations(...)))`)
 * realmente produzca la matriz de features contra PostgREST de verdad. Acá pega contra la DB.
 *
 * Requiere (ver e2e/plans.spec.ts): `just up` (con seed `20260624055009`) + admin sembrado
 * (`just create-first-user` + `scripts/set-admin.ts`).
 */

const vars = loadDevVars();
const SUPABASE_URL = vars.SUPABASE_URL ?? "";
const ANON_KEY = vars.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = vars.SUPABASE_SERVICE_ROLE_KEY ?? "";
const EMAIL = process.env.E2E_USER_EMAIL ?? vars.BOOTSTRAP_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? vars.BOOTSTRAP_ADMIN_PASSWORD ?? "";

const canRun = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && EMAIL && PASSWORD);

const TEST_SLUG = "e2e-academy-test";

// Las 6 primeras features del seed por sort_order — son exactamente las que incluye Bronze
// (pricing acumulativo: bronze → sort_order <= 6). Valida el JOIN M:N + el orden.
const BRONZE_FEATURE_SLUGS = [
  "intensive-seminar",
  "intro-followup-classes",
  "community",
  "lifetime-platform",
  "live-classes-1-week",
  "basic-training",
];

async function getAccessToken(): Promise<string> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`No se pudo obtener el token e2e: ${error?.message ?? "sin sesión"}`);
  }
  return data.session.access_token;
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Ids reales de features por slug (vía service-role; no hay endpoint de features). */
async function featureIdsBySlug(slugs: string[]): Promise<number[]> {
  const { data, error } = await serviceClient()
    .from("investep_features")
    .select("id, slug")
    .in("slug", slugs);
  if (error || !data) throw new Error(`No se pudieron leer features: ${error?.message ?? "vacío"}`);
  return slugs.map((s) => {
    const row = data.find((d) => d.slug === s);
    if (!row) throw new Error(`Feature seed faltante: ${s}`);
    return row.id as number;
  });
}

async function deleteTestPlan(): Promise<void> {
  await serviceClient().from("investep_plans").delete().eq("slug", TEST_SLUG);
}

interface AcademyPlanView {
  id: number;
  slug: string;
  name: string | null;
  subtitle: string | null;
  priceRegular: number;
  priceOffer: number | null;
  currency: string;
  features: { id: number; slug: string; label: string | null }[];
}

test.describe.configure({ mode: "serial" });

test.describe("academy: embedding M:N contra la DB real (E2E)", () => {
  test.skip(!canRun, "Faltan SUPABASE_URL/keys o credenciales de admin (.dev.vars). Ver header.");

  let authHeaders: Record<string, string> = {};

  test.beforeAll(async () => {
    authHeaders = { Authorization: `Bearer ${await getAccessToken()}` };
    await deleteTestPlan(); // estado limpio (restos de corridas previas)
  });

  test.afterAll(async () => {
    await deleteTestPlan();
  });

  test("GET /academy/plans devuelve la matriz de features del seed (embedding + orden)", async ({
    request,
  }) => {
    const res = await request.get("/academy/plans?locale=es", { headers: authHeaders });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { locale: string; plans: AcademyPlanView[] };

    const bronze = body.plans.find((p) => p.slug === "bronze");
    expect(bronze, "el tier 'bronze' del seed debe estar presente").toBeTruthy();
    expect(bronze?.name).toBe("Paquete Bronce");
    expect(bronze?.priceRegular).toBe(4999);
    expect(bronze?.priceOffer).toBe(2199);

    // El embedding M:N + el orden por sort_order: bronze incluye exactamente las 6 primeras.
    expect(bronze?.features.map((f) => f.slug)).toEqual(BRONZE_FEATURE_SLUGS);
    // La label viene de la traducción ES embebida (no es null).
    const community = bronze?.features.find((f) => f.slug === "community");
    expect(community?.label).toBe("Acceso a nuestra comunidad de inversiones");
  });

  test("POST admin + GET cliente: las features asociadas round-trip por la DB", async ({
    request,
  }) => {
    const featureIds = await featureIdsBySlug(["community", "doublegreen"]);

    const created = await request.post("/admin/academy/plans", {
      headers: authHeaders,
      data: {
        slug: TEST_SLUG,
        priceRegular: 100,
        priceOffer: 50,
        currency: "USD",
        sortOrder: 99,
        isActive: true,
        translations: [{ locale: "es", name: "Paquete E2E", subtitle: "Prueba" }],
        featureIds,
      },
    });
    expect(created.status()).toBe(201);
    const { plan } = (await created.json()) as { plan: { id: number; featureIds: number[] } };
    expect([...plan.featureIds].sort()).toEqual([...featureIds].sort());

    // GET cliente: el embedding debe traer las 2 features asociadas con su label ES.
    const res = await request.get("/academy/plans?locale=es", { headers: authHeaders });
    const body = (await res.json()) as { plans: AcademyPlanView[] };
    const mine = body.plans.find((p) => p.slug === TEST_SLUG);
    expect(mine?.name).toBe("Paquete E2E");
    expect(mine?.features.map((f) => f.slug).sort()).toEqual(["community", "doublegreen"]);
    expect(mine?.features.find((f) => f.slug === "doublegreen")?.label).toBe(
      "DoubleGREEN (2 meses)",
    );

    // Limpieza explícita vía la propia API (DELETE admin).
    const deleted = await request.delete(`/admin/academy/plans/${plan.id}`, {
      headers: authHeaders,
    });
    expect(deleted.status()).toBe(200);
  });

  test("PATCH con un featureId inválido → 422 y NO destruye las features existentes (DB real)", async ({
    request,
  }) => {
    const [communityId] = await featureIdsBySlug(["community"]);

    const created = await request.post("/admin/academy/plans", {
      headers: authHeaders,
      data: {
        slug: TEST_SLUG,
        priceRegular: 100,
        currency: "USD",
        isActive: true,
        translations: [{ locale: "es", name: "Paquete E2E" }],
        featureIds: [communityId],
      },
    });
    expect(created.status()).toBe(201);
    const { plan } = (await created.json()) as { plan: { id: number } };

    // PATCH que pide reemplazar por [community, <id inexistente>]: el INSERT falla por FK.
    const patched = await request.patch(`/admin/academy/plans/${plan.id}`, {
      headers: authHeaders,
      data: { featureIds: [communityId, 999_999_999] },
    });
    expect(patched.status()).toBe(422);

    // Lo que importa: insert-before-delete → la feature original sigue ahí, NO se vació el set.
    const list = await request.get("/admin/academy/plans", { headers: authHeaders });
    const mine = (
      (await list.json()) as { plans: { slug: string; featureIds: number[] }[] }
    ).plans.find((p) => p.slug === TEST_SLUG);
    expect(mine?.featureIds).toEqual([communityId]);

    await request.delete(`/admin/academy/plans/${plan.id}`, { headers: authHeaders });
  });
});
