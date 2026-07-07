/**
 * Dominio: RECOMMENDED BOOKS — lista curada de libros recomendados
 * (investepacademy.com/librostransformacion).
 *
 * Reglas no negociables (AGENTS.md §5/§6):
 *   - Lista de SOLO LECTURA para el cliente; las mutaciones son admin-only.
 *   - No se vende nada acá (eso es `products`/tienda): cada libro enlaza a un recurso
 *     externo (audiolibro en YouTube o ficha de Amazon).
 *
 * Barrera del feature: re-exporta el router CLIENTE (`/recommended-books`, lectura) y el
 * router ADMIN (`/admin/recommended-books`, CRUD protegido por `requireAdmin`).
 */
export { adminRecommendedBooksRouter, recommendedBooksRouter } from "./recommended-books.router";
