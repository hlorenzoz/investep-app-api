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
          "429→RATE_LIMITED (transitorio: esperar y reintentar), " +
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

/**
 * Símbolo de ticker normalizado y validado. Fuente ÚNICA compartida entre features
 * (tickers, operations) para que un símbolo aceptado por un endpoint no lo rechace otro.
 * - Normaliza: recorta espacios y pasa a mayúsculas.
 * - Acepta índices (^GSPC) y clases de acción (BRK.B); acota a 1-12 caracteres.
 * El CHECK `trade_operations_ticker_check` de la DB replica este patrón (defensa en profundidad).
 */
export const tickerSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(12)
  .regex(/^[A-Z0-9.^-]+$/, "Símbolo inválido (solo A-Z, 0-9, '.', '^' o '-'; máx 12).");
