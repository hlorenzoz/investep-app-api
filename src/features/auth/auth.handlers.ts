import type { RouteHandler } from "@hono/zod-openapi";
import type { AuthedBindings } from "../../types/app";
import type { MeRoute } from "./auth.routes";

/**
 * GET /auth/me — el usuario ya fue validado y cargado por `requireAuth`,
 * así que el handler solo lo proyecta a la respuesta.
 */
export const meHandler: RouteHandler<MeRoute, AuthedBindings> = (c) => {
  const user = c.get("user");
  return c.json({ user }, 200);
};
