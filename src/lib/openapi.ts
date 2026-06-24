import type { Hook } from "@hono/zod-openapi";
import { ErrorSchema } from "../schemas/common";
import type { AppBindings } from "../types/app";
import { toErrorResponse } from "./errors";

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

/**
 * Hook de validación por defecto de OpenAPIHono: toda falla de validación Zod en el borde
 * de la petición se traduce al formato de error único (AGENTS.md §4) con status 422.
 * Extraído acá (en vez de inline en `createApp`) para poder testearlo de forma aislada.
 */
export const validationHook: Hook<unknown, AppBindings, string, unknown> = (result, c) => {
  if (!result.success) {
    return c.json(
      toErrorResponse("VALIDATION_ERROR", "La solicitud no es válida.", result.error.issues),
      422,
    );
  }
};
