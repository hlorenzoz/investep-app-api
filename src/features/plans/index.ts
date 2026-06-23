import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";

/**
 * Dominio: PLANS — planes de inversión y contenido de la academia.
 *
 * Stub inicial. Seguí el patrón de `features/health/` para agregar endpoints
 * (rutas con `createRoute`, handlers tipados, router con `.openapi(...)`, tests).
 */
export const plansRouter = new OpenAPIHono<AppBindings>();
