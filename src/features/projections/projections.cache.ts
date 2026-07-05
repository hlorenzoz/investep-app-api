import type { ProjectionAccountType, ProjectionGrouping } from "./projections.service";

/**
 * Caché KV de proyecciones. La serie es una función pura de (accountType, ratePct,
 * baseAmount, startDate, grouping, years), así que la clave se arma EXACTAMENTE con esos
 * determinantes — NO con `planId`. Clavear en la tasa (no en el id) evita servir una serie
 * vieja si un admin edita el plan (`PATCH /admin/plans` cambia la tasa → cambia la clave).
 *
 * El acceso es DEFENSIVO: si el binding no expone `get`/`put` (p. ej. el `{}` de los tests)
 * o falla, degrada a no-cache sin romper la request.
 */

/** Días de TTL — la serie no cambia salvo que cambien los inputs (o `CALC_VERSION`). */
const TTL_SECONDS = 24 * 60 * 60;

/** Bump ante cambios de la fórmula o de la forma de la clave: invalida lo viejo sin borrarlo. */
const CALC_VERSION = "v2";

export interface ProjectionCacheKey {
  accountType: ProjectionAccountType;
  /** Tasa efectiva del plan (mensual para equity, diaria para options). Su cambio invalida el cache. */
  ratePct: number;
  baseAmount: number;
  startDate: Date;
  grouping: ProjectionGrouping;
  years?: number;
}

export function projectionCacheKey(k: ProjectionCacheKey): string {
  const date = k.startDate.toISOString().slice(0, 10);
  const years = k.years ?? "def";
  return `proj:${CALC_VERSION}:${k.accountType}:${k.ratePct}:${k.baseAmount}:${date}:${k.grouping}:${years}`;
}

type MaybeKv = Pick<KVNamespace, "get" | "put"> | undefined | null;

export async function readProjectionCache(kv: MaybeKv, key: string): Promise<string | null> {
  if (!kv || typeof kv.get !== "function") return null;
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

export async function writeProjectionCache(kv: MaybeKv, key: string, body: string): Promise<void> {
  if (!kv || typeof kv.put !== "function") return;
  try {
    await kv.put(key, body, { expirationTtl: TTL_SECONDS });
  } catch {
    // El cache es best-effort: un fallo de escritura no debe afectar la respuesta.
  }
}
