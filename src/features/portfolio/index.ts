import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../../types/app";

/**
 * Dominio: PORTFOLIO — saldos, posiciones, órdenes y transacciones del usuario,
 * obtenidos en SOLO LECTURA desde brókers vía agregador (AGENTS.md §1/§5).
 *
 * Stub inicial. Los refrescos periódicos van en Cron Triggers / Queues, nunca
 * bloqueando una request (AGENTS.md §3/§6). Seguí el patrón de `features/health/`.
 */
export const portfolioRouter = new OpenAPIHono<AppBindings>();
