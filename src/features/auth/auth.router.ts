import { OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "../../middleware/auth";
import type { AuthedBindings } from "../../types/app";
import { meHandler } from "./auth.handlers";
import { meRoute } from "./auth.routes";

/**
 * Router del dominio AUTH. La validación de sesión se delega a Supabase Auth;
 * `requireAuth` envuelve cada ruta protegida y carga el usuario en el contexto.
 */
export const authRouter = new OpenAPIHono<AuthedBindings>();

// Protege /auth/me: valida el JWT antes de ejecutar el handler.
authRouter.use("/me", requireAuth);
authRouter.openapi(meRoute, meHandler);
