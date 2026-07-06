/**
 * Dominio: PRODUCTS (Tienda) — catálogo de productos (libros, remeras, gorras).
 *
 * Reglas no negociables:
 *   - Catálogo de SOLO LECTURA para el cliente; las mutaciones son admin-only.
 *   - RLS deny-all en `products`: todo el acceso pasa por el service-role client
 *     desde la API (a diferencia de `brokers`, que sí expone lectura a `authenticated`).
 *
 * Barrera del feature: re-exporta el router CLIENTE (`/tienda`, lectura) y el
 * router ADMIN (`/admin/tienda`, CRUD protegido por `requireAdmin`).
 */
export { adminProductsRouter, productsRouter } from "./products.router";
