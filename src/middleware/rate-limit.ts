import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import { logError, logWarn } from "../lib/log";
import type { AppBindings } from "../types/app";
import type { Env, RateLimiter } from "../types/env";

/** Opciones del middleware de rate limiting. */
export interface RateLimitOptions {
  /** Resuelve el binding desde el env (inyectable para tests). `undefined` → fail-open. */
  getLimiter: (env: Env) => RateLimiter | undefined;
  /** Si se define, solo limita estos métodos HTTP (p. ej. mutaciones). Vacío/ausente = todos. */
  methods?: readonly string[];
  /** Nombre del limiter para el evento de log cuando el binding falta. */
  name: string;
}

/**
 * Middleware de rate limiting sobre el binding nativo de Workers (per-colo, por IP).
 *
 * - La key es la IP del cliente (`CF-Connecting-IP`, header confiable que setea Cloudflare
 *   y no puede falsificar el cliente). Sin header (tests/local) → "unknown".
 * - Binding ausente → FAIL-OPEN. Fuera de development se loguea EN CADA request (sin estado
 *   en memoria entre peticiones, AGENTS.md §3): un control de seguridad apagado en
 *   staging/producción debe ser ruidoso y alertable, no un warn esporádico por isolate.
 * - Límite excedido → `AppError(RATE_LIMITED, 429)` + evento de seguridad `rate_limited`
 *   (AGENTS.md §12: los rate-limit se loguean explícitamente para auditoría).
 *
 * Debe registrarse ANTES de `requireAuth` en el router: el punto es frenar fuerza bruta
 * pre-autenticación.
 */
export function createRateLimitMiddleware(opts: RateLimitOptions): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (opts.methods && !opts.methods.includes(c.req.method.toUpperCase())) {
      return next();
    }

    const limiter = opts.getLimiter(c.env);
    if (!limiter) {
      if (c.env.ENVIRONMENT !== "development") {
        logError("rate_limiter_missing", { limiter: opts.name, environment: c.env.ENVIRONMENT });
      }
      return next();
    }

    const key = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key });
    if (!success) {
      // Evento de seguridad (§12). Método+path para correlación; la IP no se loguea
      // (dato personal, §5) — la observabilidad de Workers ya la asocia a la request.
      logWarn("rate_limited", {
        limiter: opts.name,
        method: c.req.method,
        path: c.req.path,
      });
      throw new AppError(
        "RATE_LIMITED",
        "Demasiadas solicitudes. Esperá un momento y volvé a intentar.",
        429,
      );
    }

    return next();
  };
}
