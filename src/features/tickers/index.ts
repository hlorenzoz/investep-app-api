/**
 * Dominio: TICKERS — activos financieros, relaciones apalancadas/inversas y planes.
 * Barrera del feature: re-exporta el router CLIENTE (`/tickers`, lectura) y el router
 * ADMIN (`/admin/tickers`, CRUD, relaciones y planes).
 */
export { adminTickersRouter, tickersRouter } from "./tickers.router";
