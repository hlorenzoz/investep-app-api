import { ErrorSchema } from "../schemas/common";

/**
 * Configuración base del documento OpenAPI. El spec generado es la fuente de verdad
 * que consumen los clientes Flutter y SvelteKit (AGENTS.md §4).
 */
export const openApiConfig = {
  openapi: "3.1.0",
  info: {
    title: "Investep App API",
    version: "0.1.0",
    description: "API REST de Investep App. Backend central para clientes Flutter y SvelteKit.",
  },
} as const;

/** Respuesta de error JSON reutilizable en las definiciones de ruta (4xx/5xx). */
export function jsonErrorResponse(description: string) {
  return {
    content: {
      "application/json": {
        schema: ErrorSchema,
      },
    },
    description,
  };
}
