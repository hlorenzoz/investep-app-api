import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import type { AuthedBindings } from "../types/app";

/**
 * Guard de administrador. Debe encadenarse SIEMPRE después de `requireAuth`:
 * lee `user` del contexto (lo deja `requireAuth`) y exige `isAdmin === true`,
 * leído de `app_metadata.is_admin` (control de seguridad server-side, no
 * escribible por el usuario). Sin admin → `FORBIDDEN` (403), distinto del 401
 * de "no autenticado": el token es válido, pero al usuario le faltan permisos.
 *
 * El gate vive en la capa app porque los handlers usan el service-role client
 * (que bypassa RLS); este middleware es la única barrera de autorización para
 * las mutaciones de catálogo (brokers, plans).
 */
export function createAdminMiddleware(): MiddlewareHandler<AuthedBindings> {
  return async (c, next) => {
    if (!c.get("user").isAdmin) {
      throw new AppError("FORBIDDEN", "Se requiere acceso de administrador.", 403);
    }
    await next();
  };
}

/** Middleware listo para envolver rutas que solo un administrador puede ejecutar. */
export const requireAdmin = createAdminMiddleware();
