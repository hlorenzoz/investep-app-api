import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAuth } from "../../middleware/auth";
import { createRateLimitMiddleware } from "../../middleware/rate-limit";
import type { AuthedBindings } from "../../types/app";
import { changePasswordHandler, meHandler } from "./auth.handlers";
import { changePasswordRoute, meRoute } from "./auth.routes";

/**
 * Router del dominio AUTH. La validación de sesión se delega a Supabase Auth;
 * `requireAuth` envuelve cada ruta protegida y carga el usuario en el contexto.
 * El `defaultHook` traduce las fallas de validación Zod (p. ej. body de
 * change-password) al formato de error único (AGENTS.md §4).
 */
export const authRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

// Rate limiting por IP en TODO el dominio auth, ANTES de requireAuth: frena
// fuerza bruta pre-autenticación. El router es dueño de su propia protección.
authRouter.use(
  "*",
  createRateLimitMiddleware({
    name: "AUTH_RATE_LIMITER",
    getLimiter: (env) => env.AUTH_RATE_LIMITER,
  }),
);

// Protege /auth/me: valida el JWT antes de ejecutar el handler.
authRouter.use("/me", requireAuth);
authRouter.openapi(meRoute, meHandler);

// Protege /auth/change-password: el userId sale del token, nunca del body.
authRouter.use("/change-password", requireAuth);
authRouter.openapi(changePasswordRoute, changePasswordHandler);
