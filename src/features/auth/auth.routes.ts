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

export const ChangePasswordRequestSchema = z
  .object({
    newPassword: z.string().openapi({ example: "una-contraseña-nueva-segura" }),
  })
  .openapi("ChangePasswordRequest");

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

export const changePasswordRoute = createRoute({
  method: "post",
  path: "/change-password",
  tags: ["Auth"],
  summary: "Cambiar la contraseña del usuario autenticado",
  description:
    "Cambia la contraseña del usuario asociado al JWT y apaga el flag de reset obligatorio " +
    "(`must_reset_password`), que vive en `app_metadata` y solo es escribible server-side. " +
    "Tras el cambio se revocan todas las sesiones del usuario: hay que volver a iniciar sesión.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: ChangePasswordRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: AuthUserSchema } },
      description: "Contraseña cambiada; `mustResetPassword` pasa a `false`.",
    },
    400: jsonErrorResponse("La contraseña no cumple la política mínima o la rechaza Supabase."),
    401: jsonErrorResponse("Falta o es inválido el token."),
    422: jsonErrorResponse("Cuerpo inválido: falta `newPassword` o no es un string."),
    500: jsonErrorResponse("Error inesperado de Supabase al cambiar la contraseña."),
    503: jsonErrorResponse("Supabase no disponible; reintentá en unos segundos."),
  },
});

export type ChangePasswordRoute = typeof changePasswordRoute;
