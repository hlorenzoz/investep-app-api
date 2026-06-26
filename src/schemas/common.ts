import { z } from "@hono/zod-openapi";
import { ERROR_CODES } from "../lib/errors";

/**
 * Formato de error único de la API (AGENTS.md §4). Se registra en los componentes
 * OpenAPI y se reutiliza en las respuestas 4xx/5xx de cada ruta.
 */
export const ErrorSchema = z
  .object({
    error: z.object({
      // Enum explícito (no `string`): el cliente sabe qué códigos existen y puede tiparlos.
      code: z.enum(ERROR_CODES).openapi({
        description:
          "Código de error estable. Mapeo por status: 400/422→VALIDATION_ERROR, " +
          "401→UNAUTHORIZED, 403→FORBIDDEN, 404→NOT_FOUND, 409→CONFLICT, " +
          "500→INTERNAL_ERROR, 503→SERVICE_UNAVAILABLE (transitorio: reintentar, no desloguear).",
        example: "VALIDATION_ERROR",
      }),
      message: z.string().openapi({
        description: "Mensaje legible y seguro de mostrar al usuario. Nunca filtra internals.",
        example: "La solicitud no es válida.",
      }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export type ErrorResponse = z.infer<typeof ErrorSchema>;
