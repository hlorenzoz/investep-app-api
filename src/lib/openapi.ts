import type { Hook } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ErrorSchema } from "../schemas/common";
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
 *
 * Es una factory genérica por binding (`E`): cada router fija su `E` exacto. Necesario porque
 * los sub-routers usan `AuthedBindings` y el app principal `AppBindings`, y el `Context` de Hono
 * es invariante en sus `Variables` — un único hook tipado no sirve para ambos.
 */
export function validationHook<E extends Env>(): Hook<unknown, E, string, unknown> {
  return (result, c) => {
    if (!result.success) {
      return c.json(
        toErrorResponse("VALIDATION_ERROR", "La solicitud no es válida.", result.error.issues),
        422,
      );
    }
  };
}
