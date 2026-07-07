import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse } from "../../lib/openapi";

export const UserSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b" }),
    email: z.string().email().openapi({ example: "user@example.com" }),
    role: z.enum(["admin", "manager", "user"]).openapi({ example: "user" }),
    fullName: z.string().nullable().openapi({ example: "Juan Pérez" }),
    createdAt: z.string().openapi({ example: "2026-06-30T16:28:24.000Z" }),
    mustResetPassword: z.boolean().openapi({ example: false }),
    planSlug: z.string().nullable().optional().openapi({ example: "bronze" }),
  })
  .openapi("User");

export const UsersResponseSchema = z
  .object({
    users: z.array(UserSchema),
  })
  .openapi("UsersResponse");

export const UserEnvelopeSchema = z
  .object({
    user: UserSchema,
  })
  .openapi("UserEnvelope");

export const CreateUserSchema = z
  .object({
    email: z.string().email().openapi({ example: "newuser@example.com" }),
    fullName: z.string().min(1).nullable().optional().openapi({ example: "Juan Pérez" }),
    role: z.enum(["admin", "manager", "user"]).default("user").openapi({ example: "user" }),
    password: z.string().min(8).optional().openapi({ example: "contraseñaSegura123" }),
    planSlug: z.string().nullable().optional().openapi({ example: "bronze" }),
  })
  .openapi("CreateUser");

export const UpdateUserSchema = z
  .object({
    email: z.string().email().optional().openapi({ example: "updated@example.com" }),
    fullName: z.string().min(1).nullable().optional().openapi({ example: "Juan Pérez Modificado" }),
    role: z.enum(["admin", "manager", "user"]).optional().openapi({ example: "manager" }),
    password: z.string().min(8).optional().openapi({ example: "nuevaContraseñaSegura123" }),
    planSlug: z.string().nullable().optional().openapi({ example: "bronze" }),
  })
  .openapi("UpdateUser");

const UserIdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b",
      description: "UUID del usuario.",
    }),
});

// --- Rutas ---

export const listUsersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users Admin"],
  summary: "Listar usuarios registrados",
  description:
    "Retorna la lista de todos los usuarios registrados en Supabase Auth combinados en memoria con sus perfiles de la base de datos PostgreSQL (`public.profiles`) para incluir el nombre completo (`fullName`). **Restringido únicamente a administradores (rol `admin`)**. Retorna un error `403` si es invocado por usuarios o managers.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: UsersResponseSchema } },
      description: "Listado de usuarios obtenido exitosamente.",
    },
    401: jsonErrorResponse("Token de administrador inválido, expirado o ausente."),
    403: jsonErrorResponse(
      "Acceso denegado. Se requiere privilegios de administrador (rol `admin`).",
    ),
    500: jsonErrorResponse(
      "Error interno inesperado en el servidor al consolidar el listado de usuarios.",
    ),
  },
});

export const getUserRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users Admin"],
  summary: "Obtener detalle de un usuario",
  description:
    "Busca y devuelve la información detallada de un único usuario a partir de su UUID. Combina sus datos de autenticación de Supabase Auth con su perfil en la base de datos PostgreSQL. **Restringido únicamente a administradores (rol `admin`)**.",
  security: [{ bearerAuth: [] }],
  request: { params: UserIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: UserEnvelopeSchema } },
      description: "Detalle del usuario obtenido exitosamente.",
    },
    401: jsonErrorResponse("Token de administrador inválido, expirado o ausente."),
    403: jsonErrorResponse(
      "Acceso denegado. Se requiere privilegios de administrador (rol `admin`).",
    ),
    404: jsonErrorResponse("Usuario no encontrado para el UUID provisto."),
    500: jsonErrorResponse("Error interno inesperado en el servidor."),
  },
});

export const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users Admin"],
  summary: "Aprovisionar un nuevo usuario",
  description:
    "Crea o re-provisiona un usuario de manera idempotente. " +
    "1. **Creación**: Si el email no existe, crea la cuenta en Supabase Auth con confirmación automática. " +
    "2. **Idempotencia**: Si el email ya está registrado, reinicia su contraseña con el nuevo valor (o una aleatoria si no se especifica). " +
    "3. **Metadatos y Rol**: Escribe el rol provisto (`admin`, `manager`, `user`) y activa `must_reset_password: true` en los metadatos protegidos de Supabase Auth (`app_metadata`). " +
    "4. **Perfil**: Registra o actualiza el nombre del usuario (`fullName`) en la tabla `public.profiles`. " +
    "5. **Notificación**: Envía un correo electrónico transaccional mediante Resend con las credenciales de acceso iniciales. " +
    "**Restringido únicamente a administradores (rol `admin`)**.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreateUserSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: UserEnvelopeSchema } },
      description: "Usuario aprovisionado exitosamente. Se envió el correo de credenciales.",
    },
    400: jsonErrorResponse(
      "Datos de entrada inválidos (`VALIDATION_ERROR`): la contraseña provista es muy débil o el email ya está en uso.",
    ),
    401: jsonErrorResponse("Token de administrador inválido, expirado o ausente."),
    403: jsonErrorResponse(
      "Acceso denegado. Se requiere privilegios de administrador (rol `admin`).",
    ),
    429: jsonErrorResponse(
      "Demasiadas mutaciones de usuarios desde esta IP (`RATE_LIMITED`). Esperá y reintentá.",
    ),
    500: jsonErrorResponse(
      "Error interno inesperado en el servidor al interactuar con Supabase Auth o al enviar el email.",
    ),
  },
});

export const updateUserRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Users Admin"],
  summary: "Actualizar un usuario",
  description:
    "Modifica de forma parcial y segura las propiedades de un usuario existente identificado por su UUID. " +
    "- Permite actualizar su email, rol administrativo (`admin`, `manager`, `user`) y su nombre completo (`fullName`). " +
    "- Si se provee una contraseña en el campo `password`, se cambia en Supabase Auth y se activa automáticamente el flag `must_reset_password: true` para exigir el cambio de clave en su próximo login. " +
    "**Restringido únicamente a administradores (rol `admin`)**.",
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateUserSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UserEnvelopeSchema } },
      description: "Usuario actualizado exitosamente.",
    },
    400: jsonErrorResponse(
      "Datos de entrada inválidos (`VALIDATION_ERROR`): la nueva contraseña no cumple con los requisitos mínimos de seguridad o el nuevo email ya está en uso.",
    ),
    401: jsonErrorResponse("Token de administrador inválido, expirado o ausente."),
    403: jsonErrorResponse(
      "Acceso denegado. Se requiere privilegios de administrador (rol `admin`).",
    ),
    404: jsonErrorResponse("Usuario no encontrado para el UUID provisto."),
    429: jsonErrorResponse(
      "Demasiadas mutaciones de usuarios desde esta IP (`RATE_LIMITED`). Esperá y reintentá.",
    ),
    500: jsonErrorResponse(
      "Error interno inesperado en el servidor al actualizar perfiles o credenciales.",
    ),
  },
});

export const deleteUserRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Users Admin"],
  summary: "Eliminar un usuario",
  description:
    "Elimina físicamente a un usuario de Supabase Auth a partir de su UUID. " +
    "La eliminación disparará en cascada en la base de datos PostgreSQL la remoción de su perfil (`profiles`) y toda la información vinculada a su cuenta. " +
    "**Restringido únicamente a administradores (rol `admin`)**.",
  security: [{ bearerAuth: [] }],
  request: { params: UserIdParamSchema },
  responses: {
    200: {
      description: "Usuario y perfil eliminados exitosamente de forma permanente.",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean().openapi({ example: true }) }),
        },
      },
    },
    401: jsonErrorResponse("Token de administrador inválido, expirado o ausente."),
    403: jsonErrorResponse(
      "Acceso denegado. Se requiere privilegios de administrador (rol `admin`).",
    ),
    404: jsonErrorResponse("Usuario no encontrado para el UUID provisto."),
    429: jsonErrorResponse(
      "Demasiadas mutaciones de usuarios desde esta IP (`RATE_LIMITED`). Esperá y reintentá.",
    ),
    500: jsonErrorResponse(
      "Error interno inesperado en el servidor al realizar el borrado en cascada en Supabase Auth.",
    ),
  },
});
