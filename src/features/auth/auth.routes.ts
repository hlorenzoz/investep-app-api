import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

export const AuthUserSchema = z
  .object({
    user: z.object({
      id: z.string().openapi({ example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b" }),
      email: z.string().openapi({ example: "user@example.com" }),
      mustResetPassword: z.boolean().openapi({ example: false }),
    }),
  })
  .openapi("AuthUser");

export const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "Usuario autenticado",
  description:
    "Devuelve el usuario asociado al JWT de Supabase enviado en `Authorization: Bearer <token>`. " +
    "El backend valida el token contra Supabase Auth; responde 401 si falta o es inválido.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: AuthUserSchema } },
      description: "El token es válido; devuelve el usuario autenticado.",
    },
    401: jsonErrorResponse("Falta o es inválido el token."),
  },
});

export type MeRoute = typeof meRoute;
