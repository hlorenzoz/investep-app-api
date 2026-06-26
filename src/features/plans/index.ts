/**
 * Dominio: PLANS — catálogo de planes de inversión (target mensual por tipo de cuenta).
 * Barrera del feature: re-exporta el router CLIENTE (`/plans`, lectura) y el router
 * ADMIN (`/admin/plans`, CRUD protegido por `requireAdmin`).
 */
export { adminPlansRouter, plansRouter } from "./plans.router";
