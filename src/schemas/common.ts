import { z } from "@hono/zod-openapi";

/**
 * Formato de error único de la API (AGENTS.md §4). Se registra en los componentes
 * OpenAPI y se reutiliza en las respuestas 4xx/5xx de cada ruta.
 */
export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "La solicitud no es válida." }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export type ErrorResponse = z.infer<typeof ErrorSchema>;
