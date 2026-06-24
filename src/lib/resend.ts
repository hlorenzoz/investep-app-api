import type { Env } from "../types/env";
import { AppError } from "./errors";

/** Endpoint REST de Resend para enviar correos. */
const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

/**
 * Config mínima del cliente: solo los dos secretos de Resend. Tiparlo como `Pick`
 * (en vez de `Env`) deja explícito qué lee y permite invocarlo desde un handler
 * (`c.env`), un cron, una queue o un script sin tener que armar un `Env` completo.
 */
export type ResendConfig = Pick<Env, "RESEND_API_KEY" | "RESEND_FROM">;

/** Parámetros de un correo a enviar. Debe traer al menos `html` o `text`. */
export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Remitente; por defecto el `RESEND_FROM` del dominio verificado. */
  from?: string;
  replyTo?: string | string[];
}

/** Lo único que devolvemos del envío: el id que Resend asigna al correo. */
export interface SendEmailResult {
  id: string;
}

/**
 * Envía un correo transaccional vía la API REST de Resend.
 *
 * Cliente fino sobre `fetch` (sin SDK): Workers no necesita la dependencia extra y
 * este patrón es testeable mockeando `globalThis.fetch`, igual que el readiness check.
 * Nunca filtra la API key ni la respuesta cruda de Resend al cliente (AGENTS.md §5):
 * ante un fallo, log mínimo server-side y `AppError` con mensaje genérico.
 */
export async function sendEmail(
  env: ResendConfig,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const from = params.from ?? env.RESEND_FROM;
  if (!env.RESEND_API_KEY || !from) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Resend no está configurado (falta RESEND_API_KEY o RESEND_FROM).",
      500,
    );
  }
  if (!params.html && !params.text) {
    throw new AppError("VALIDATION_ERROR", "El correo necesita cuerpo `html` o `text`.", 400);
  }

  let res: Response;
  try {
    res = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        ...(params.html ? { html: params.html } : {}),
        ...(params.text ? { text: params.text } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });
  } catch (err) {
    // El motivo real va en `cause` (diagnóstico), nunca en el mensaje hacia el cliente.
    throw new AppError(
      "INTERNAL_ERROR",
      "No se pudo contactar el servicio de correo.",
      502,
      undefined,
      {
        cause: err,
      },
    );
  }

  if (!res.ok) {
    // Log mínimo (solo el status, sin payload ni credenciales) y respuesta genérica.
    // El cuerpo de Resend (motivo de validación) viaja en `cause` para diagnóstico, no al cliente.
    const reason = await res.text();
    console.error(`Resend respondió ${res.status} al enviar un correo`);
    throw new AppError("INTERNAL_ERROR", "No se pudo enviar el correo.", 502, undefined, {
      cause: reason,
    });
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new AppError("INTERNAL_ERROR", "Respuesta inesperada del servicio de correo.", 502);
  }
  return { id: data.id };
}
