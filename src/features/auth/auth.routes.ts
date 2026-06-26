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
    "El backend valida el token contra Supabase Auth. **401** (`UNAUTHORIZED`) = token ausente/" +
    "inválido/expirado → el cliente debe re-autenticar. **503** (`SERVICE_UNAVAILABLE`) = no se pudo " +
    "verificar contra Supabase (throttling/caída): es transitorio, **reintentá; NO cierres sesión**.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: AuthUserSchema } },
      description: "El token es válido; devuelve el usuario autenticado.",
    },
    401: jsonErrorResponse("Token ausente, inválido o expirado (`UNAUTHORIZED`) → re-autenticar."),
    503: jsonErrorResponse(
      "No se pudo verificar la sesión contra Supabase — throttling/outage (`SERVICE_UNAVAILABLE`). " +
        "Transitorio: reintentá con backoff, NO desloguees al usuario.",
    ),
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
      description:
        "Contraseña cambiada; `mustResetPassword` pasa a `false`. IMPORTANTE: se revocan TODAS las " +
        "sesiones del usuario (incluida la actual) → el access token usado queda inválido; el cliente " +
        "debe limpiar la sesión local y volver a iniciar sesión con la nueva contraseña.",
    },
    400: jsonErrorResponse(
      "Contraseña inválida (`VALIDATION_ERROR`): no cumple la política mínima (≥8) o la rechaza " +
        "Supabase (igual a la anterior / débil / filtrada). Mostrar `error.message` al usuario.",
    ),
    401: jsonErrorResponse("Token ausente, inválido o expirado (`UNAUTHORIZED`) → re-autenticar."),
    422: jsonErrorResponse(
      "Cuerpo malformado (`VALIDATION_ERROR`): falta `newPassword` o no es un string. Bug del cliente.",
    ),
    500: jsonErrorResponse(
      "Error inesperado de Supabase al cambiar la contraseña (`INTERNAL_ERROR`).",
    ),
    503: jsonErrorResponse(
      "Supabase no disponible (`SERVICE_UNAVAILABLE`). Transitorio: reintentá; la contraseña NO cambió.",
    ),
  },
});

export type ChangePasswordRoute = typeof changePasswordRoute;
