/**
 * Dominio: BROKERS — catálogo de brokers soportados.
 *
 * Reglas no negociables (AGENTS.md §5/§6):
 *   - Catálogo de SOLO LECTURA para el cliente; las mutaciones son admin-only.
 *   - La conexión real con brókers de terceros (órdenes, fondos) NO vive acá: este
 *     dominio solo administra el catálogo que el setup consume.
 *
 * Barrera del feature: re-exporta el router CLIENTE (`/brokers`, lectura) y el
 * router ADMIN (`/admin/brokers`, CRUD protegido por `requireAdmin`).
 */
export { adminBrokersRouter, brokersRouter } from "./brokers.router";
