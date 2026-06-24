/**
 * Plantillas de correo para el flujo de aprovisionamiento de usuarios.
 * Funciones puras: sin efectos secundarios, 100% testeables.
 */

/**
 * Escapa caracteres especiales HTML para prevenir corrupción al interpolar
 * valores en el bloque HTML del correo. Solo se aplica en el HTML; el bloque
 * text queda crudo (es texto plano).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Datos requeridos para generar el correo de credenciales. */
export interface CredentialEmailInput {
  /** Dirección de correo del destinatario (usada en el saludo y como referencia). */
  email: string;
  /** Contraseña en texto plano a incluir en el cuerpo del correo. */
  password: string;
}

/** Resultado estructurado del correo de credenciales. */
export interface CredentialEmailOutput {
  /** Asunto del correo. */
  subject: string;
  /** Cuerpo HTML del correo. */
  html: string;
  /** Cuerpo en texto plano (fallback). */
  text: string;
}

/**
 * Construye el correo de entrega de credenciales para un usuario aprovisionado.
 * Idioma: español. Incluye la dirección de correo y la contraseña del usuario,
 * y muestra una advertencia de seguridad instruyendo el cambio inmediato de contraseña.
 *
 * Función pura: misma entrada → misma salida, sin efectos secundarios.
 *
 * @param input - Email y contraseña del usuario aprovisionado.
 * @returns Objeto con subject, html y text listos para enviar vía Resend.
 */
export function credentialEmail(input: CredentialEmailInput): CredentialEmailOutput {
  const { email, password } = input;

  const subject = "Tus credenciales de acceso — Investep";

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>Bienvenido/a a Investep</h2>
  <p>Tu cuenta fue creada por el equipo de operaciones. A continuación encontrás tus credenciales de acceso:</p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr>
      <td style="padding: 8px; font-weight: bold;">Usuario (correo):</td>
      <td style="padding: 8px;">${escapeHtml(email)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold;">Contraseña temporal:</td>
      <td style="padding: 8px; font-family: monospace;">${escapeHtml(password)}</td>
    </tr>
  </table>
  <p style="margin-top: 24px; padding: 16px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">
    <strong>⚠️ Advertencia de seguridad:</strong><br>
    Debés cambiar esta contraseña <strong>inmediatamente</strong> después de tu primer inicio de sesión.
    Esta contraseña es de un solo uso y fue enviada solo a vos.
    No la compartas con nadie.
  </p>
  <p>Si no solicitaste esta cuenta o creés que fue un error, contactá a soporte de inmediato.</p>
</body>
</html>
`.trim();

  const text = `
Bienvenido/a a Investep

Tu cuenta fue creada por el equipo de operaciones.

Credenciales de acceso:
  Usuario (correo): ${email}
  Contraseña temporal: ${password}

ADVERTENCIA DE SEGURIDAD: Debés cambiar esta contraseña inmediatamente después de tu primer inicio de sesión. Esta contraseña es de un solo uso. No la compartas con nadie.

Si no solicitaste esta cuenta, contactá a soporte de inmediato.
`.trim();

  return { subject, html, text };
}
