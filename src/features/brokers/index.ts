import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";

/**
 * Dominio: BROKERS — conexión con brókers de terceros vía un agregador
 * (SnapTrade / Plaid — elección PENDIENTE, AGENTS.md §10).
 *
 * Reglas no negociables (AGENTS.md §5/§6):
 *   - Acceso SOLO LECTURA: nada de colocar/modificar/cancelar órdenes ni mover fondos.
 *   - Tokens OAuth del agregador SIEMPRE cifrados en reposo; nunca en logs ni respuestas.
 *
 * Stub inicial. Seguí el patrón de `features/health/` para agregar endpoints.
 */
export const brokersRouter = new OpenAPIHono<AppBindings>();
