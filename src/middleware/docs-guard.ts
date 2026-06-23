import type { MiddlewareHandler } from "hono";
import { toErrorResponse } from "../lib/errors";
import type { AppBindings } from "../types/app";

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

  if (c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json(toErrorResponse("UNAUTHORIZED", "Documentación protegida."), 401);
  }

  return next();
};
