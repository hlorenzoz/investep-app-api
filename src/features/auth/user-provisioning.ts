/**
 * Servicio de aprovisionamiento de usuarios.
 *
 * Crea o resetea un usuario en Supabase Auth de forma idempotente y entrega
 * las credenciales por correo. Nunca loguea contraseñas en ningún path.
 */
import { AppError } from "../../lib/errors";
import type { SendEmailParams, SendEmailResult } from "../../lib/resend";
import type { AppSupabaseClient } from "../../lib/supabase";
import { generatePassword } from "./password";
import { credentialEmail } from "./templates";

// ---------------------------------------------------------------------------
// Interfaces públicas
// ---------------------------------------------------------------------------

/** Dependencias inyectadas en `provisionUser`. Modeladas como objetos planos para testabilidad. */
export interface ProvisionUserDeps {
  /** Cliente Supabase inicializado con la service-role key. */
  admin: AppSupabaseClient;
  /** Función de envío de correo; firma coincide con `sendEmail` de `src/lib/resend`. */
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
}

/** Input aceptado por `provisionUser`. */
export interface ProvisionUserInput {
  /** Dirección de correo del usuario destino. */
  email: string;
  /**
   * Contraseña explícita opcional. Cuando está ausente, se llama a `generatePassword()`.
   * Los scripts pueden pasar una contraseña provista por el operador; los tests pueden
   * pasar una fija para reproducibilidad.
   */
  password?: string;
}

/** Resultado resuelto tras el aprovisionamiento. */
export interface ProvisionUserResult {
  /** UUID de Supabase Auth del usuario. */
  userId: string;
  /** Correo normalizado del usuario aprovisionado. */
  email: string;
  /**
   * `true` si el usuario fue creado; `false` si ya existía y se reseteó su contraseña
   * (path idempotente).
   */
  created: boolean;
  /** ID de entrega de Resend para trazabilidad. */
  emailId: string;
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * Crea o resetea idempotentemente un usuario en Supabase Auth y entrega
 * las credenciales por correo electrónico. Nunca loguea la contraseña.
 *
 * Algoritmo:
 * 1. Intenta `createUser` (path optimista — rápido para usuarios nuevos).
 * 2. Si Supabase devuelve "already registered", localiza al usuario via `findUserByEmail`
 *    y llama a `updateUserById` con la nueva contraseña.
 * 3. Envía el correo de credenciales vía `deps.sendEmail`.
 *
 * @throws {AppError} ante errores de la API de Supabase o fallo de entrega de correo.
 */
export async function provisionUser(
  deps: ProvisionUserDeps,
  input: ProvisionUserInput,
): Promise<ProvisionUserResult> {
  const password = input.password ?? generatePassword();
  // Normalizar email a minúsculas: GoTrue almacena en lowercase; la comparación
  // en findUserByEmail usa este valor, garantizando idempotencia case-insensitive.
  const email = input.email.trim().toLowerCase();

  // Path optimista: intento de creación
  const { data: createData, error: createError } = await deps.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_reset_password: true },
  });

  let userId: string;
  let created: boolean;

  if (!createError) {
    // Usuario nuevo creado exitosamente
    const user = createData.user;
    if (!user?.id) {
      throw new AppError("INTERNAL_ERROR", "Respuesta inesperada al crear el usuario.", 502);
    }
    userId = user.id;
    created = true;
  } else if (
    (createError as { code?: string }).code === "email_exists" ||
    (createError as { code?: string }).code === "user_already_exists" ||
    createError.message.includes("already registered")
  ) {
    // Path idempotente: usuario ya existe → encontrarlo y resetear contraseña
    const existing = await findUserByEmail(deps.admin, email);
    if (!existing) {
      throw new AppError(
        "NOT_FOUND",
        "El usuario ya existe pero no se pudo encontrar en la paginación.",
        404,
      );
    }

    const { error: updateError } = await deps.admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { must_reset_password: true },
    });

    if (updateError) {
      throw new AppError(
        "INTERNAL_ERROR",
        "No se pudo actualizar la contraseña del usuario existente.",
        502,
      );
    }

    userId = existing.id;
    created = false;
  } else {
    throw new AppError("INTERNAL_ERROR", "Error inesperado al aprovisionar el usuario.", 502);
  }

  /**
   * Envío de credenciales por correo.
   *
   * Recovery note: si `createUser` tuvo éxito pero el envío falla, el usuario
   * queda creado en Supabase Auth. La recuperación es re-ejecutar el comando:
   * el path idempotente de reset encontrará al usuario, regenerará la contraseña
   * y reintentará el envío.
   */
  const emailContent = credentialEmail({ email, password });
  let emailId: string;
  try {
    const result = await deps.sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
    emailId = result.id;
  } catch {
    // El error original NO se incluye en el mensaje (podría contener datos sensibles)
    throw new AppError("INTERNAL_ERROR", "No se pudo enviar el correo de credenciales.", 502);
  }

  return { userId, email, created, emailId };
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Pagina `admin.auth.admin.listUsers` para encontrar un usuario por email.
 * La Admin API de Supabase no expone filtro nativo por email en `listUsers`;
 * este helper hace un scan completo paginado y hace el match del lado del cliente.
 *
 * Uso interno — no se exporta desde el feature boundary.
 *
 * @returns `{ id }` si el usuario es encontrado, `null` si no existe en ninguna página.
 */
async function findUserByEmail(
  admin: AppSupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  let page = 1;
  const perPage = 50;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new AppError("INTERNAL_ERROR", "Error al listar usuarios de Supabase.", 502);
    }

    const users = data?.users ?? [];
    const found = users.find(
      (u: { id: string; email?: string }) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (found) {
      return { id: found.id };
    }

    // Si no hay más páginas, el usuario no existe
    const nextPage = (data as unknown as { nextPage?: number | null })?.nextPage;
    if (!nextPage || users.length < perPage) {
      return null;
    }

    page = nextPage;
  }
}
