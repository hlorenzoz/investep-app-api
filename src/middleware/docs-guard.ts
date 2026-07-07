import type { MiddlewareHandler } from "hono";
import { toErrorResponse } from "../lib/errors";
import type { AppBindings } from "../types/app";

/**
 * Compara dos strings en tiempo constante respecto de su contenido: hashea ambos con
 * SHA-256 y compara los digests. Aunque la comparación final no sea byte a byte constante,
 * cualquier diferencia de timing revela bytes del HASH, no del secreto — inútil para
 * reconstruir el token por timing attack (a diferencia del `!==` directo).
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Gate de la documentación de la API (fintech: no exponer spec ni UIs sin control).
 * - development / staging: acceso abierto.
 * - production: solo con `Authorization: Bearer <DOCS_TOKEN>`. Si DOCS_TOKEN no está
 *   configurado en producción, la documentación se bloquea por completo (404).
 *
 * NOTA: la política definitiva por entorno está pendiente de confirmación (AGENTS.md §10).
 */
export const docsGuard: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.env.ENVIRONMENT !== "production") {
    return next();
  }

  const token = c.env.DOCS_TOKEN;
  if (!token) {
    return c.notFound();
  }

  const provided = c.req.header("Authorization") ?? "";
  if (!(await timingSafeEqual(provided, `Bearer ${token}`))) {
    return c.json(toErrorResponse("UNAUTHORIZED", "Documentación protegida."), 401);
  }

  return next();
};
