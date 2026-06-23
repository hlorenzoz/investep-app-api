import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";

/**
 * Dominio: AUTH — autenticación y gestión de sesión (apoyado en Supabase Auth).
 *
 * Stub inicial. Para agregar endpoints, seguí el patrón de `features/health/`:
 *   1. `auth.routes.ts`   → esquemas Zod + rutas con `createRoute` (+ `type XRoute = typeof route`).
 *   2. `auth.handlers.ts` → handlers tipados con `RouteHandler<XRoute, AppBindings>`.
 *   3. `auth.router.ts`   → `new OpenAPIHono<AppBindings>().openapi(route, handler)`.
 *   4. Validá TODA entrada externa con Zod; errores con el formato único (lib/errors).
 *   5. `auth.test.ts`     → tests con `bun test` contra `app.request()`.
 */
export const authRouter = new OpenAPIHono<AppBindings>();
