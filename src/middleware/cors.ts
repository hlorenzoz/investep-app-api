import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { AppBindings } from "../types/app";
import type { Env } from "../types/env";

const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;

/**
 * Previews de Cloudflare Pages del frontend (proyecto `investep-app`): la URL canónica
 * `investep-app.pages.dev` y los deploys `<hash|branch>.investep-app.pages.dev`, que cambian
 * en cada build. El sufijo del proyecto va ANCLADO (`$`) y solo `https`, así que NO habilita
 * `*.pages.dev` de terceros — únicamente los deploys de ESTE proyecto. Igual que localhost:
 * solo dev/staging, nunca producción (en prod el front usa su custom domain en CORS_ORIGINS).
 */
const PAGES_PREVIEW_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?investep-app\.pages\.dev$/;

/** Canoniza un origin para comparar: sin espacios, sin barra final, en minúsculas
 * (el browser manda el host en minúsculas y sin path; una config con `/` o mayúsculas
 * no debe fallar el match). */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Decide si un `Origin` está permitido y, si lo está, lo devuelve (para reflejarlo en
 * `Access-Control-Allow-Origin`); si no, `null` (sin headers CORS → el navegador bloquea).
 * - `CORS_ORIGINS` (coma-separado) es la allowlist explícita, usada en todos los entornos;
 *   se normaliza (barra final / mayúsculas) para no fallar un match por una config descuidada.
 * - Solo en `development`/`staging` se permite además cualquier `localhost` (fail-closed: un
 *   `ENVIRONMENT` ausente o mal escrito NO habilita localhost en producción).
 * Nunca se usa `*`: es una API de fintech con `Authorization`, no se expone a cualquier origen.
 * Tolera `env` undefined (invocación mal configurada) devolviendo `null` en vez de crashear.
 */
export function resolveAllowedOrigin(env: Env | undefined, origin: string): string | null {
  if (!origin) return null;
  const normalized = normalizeOrigin(origin);
  const configured = (env?.CORS_ORIGINS ?? "").split(",").map(normalizeOrigin).filter(Boolean);
  if (configured.includes(normalized)) return origin;
  // Solo en dev/staging (fail-closed: un ENVIRONMENT ausente/mal escrito no habilita nada):
  // cualquier localhost y los previews de Cloudflare Pages del frontend.
  const environment = env?.ENVIRONMENT;
  if (environment === "development" || environment === "staging") {
    if (LOCALHOST_ORIGIN.test(normalized) || PAGES_PREVIEW_ORIGIN.test(normalized)) {
      return origin;
    }
  }
  return null;
}

/**
 * Middleware CORS con allowlist por entorno. Debe registrarse temprano (antes de las rutas)
 * para que el preflight `OPTIONS` se resuelva sin pasar por `requireAuth`.
 */
export function createCorsMiddleware(): MiddlewareHandler<AppBindings> {
  return cors({
    origin: (origin, c) => resolveAllowedOrigin(c.env as Env | undefined, origin),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
}
