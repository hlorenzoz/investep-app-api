/**
 * Dominio: ACADEMY — catálogo de paquetes de membresía (tiers) de la Academia.
 * Barrera del feature: re-exporta el router CLIENTE (`/academy/plans`, lectura) y el router
 * ADMIN (`/admin/academy/plans`, CRUD protegido por `requireAdmin`).
 */
export { academyRouter, adminAcademyRouter } from "./academy.router";
