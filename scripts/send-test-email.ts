/**
 * Prueba REAL de la integración con Resend: envía un correo de verificación.
 *
 * Uso:  just email-test destinatario@dominio.com
 *       just email-test                         (usa RESEND_TEST_TO de `.dev.vars`)
 *
 * Lee RESEND_API_KEY, RESEND_FROM y el destinatario (RESEND_TEST_TO) de `.dev.vars`
 * (gitignored). El destinatario por CLI tiene prioridad sobre RESEND_TEST_TO. No envía
 * nada si falta config o destinatario. Esto pega a Resend de verdad: usalo con cuidado.
 */
import { sendEmail } from "../src/lib/resend";
import { loadDevVars } from "./_env";

const vars = loadDevVars();

// Destinatario: argumento por CLI > RESEND_TEST_TO (.dev.vars) > env del proceso.
// `||` (y no `??`) para que un argumento vacío también caiga al default.
const to = process.argv[2] || vars.RESEND_TEST_TO || process.env.RESEND_TEST_TO;
if (!to) {
  console.error(
    "Falta destinatario: pasalo como `just email-test <correo>` o definí RESEND_TEST_TO en .dev.vars",
  );
  process.exit(1);
}

const config = {
  RESEND_API_KEY: vars.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
  RESEND_FROM: vars.RESEND_FROM ?? process.env.RESEND_FROM,
};

try {
  const { id } = await sendEmail(config, {
    to,
    subject: "Prueba de integración — Investep App API",
    html: "<p>Si ves esto, la integración con <strong>Resend</strong> funciona. 🚀</p>",
    text: "Si ves esto, la integración con Resend funciona.",
  });
  console.log(`✅ Correo enviado a ${to}. Resend id: ${id}`);
} catch (err) {
  const message = err instanceof Error ? err.message : "error desconocido";
  console.error(`❌ No se pudo enviar: ${message}`);
  // En dev sí mostramos el motivo crudo de Resend (la API nunca lo expone).
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause !== undefined) console.error(`   Motivo de Resend: ${String(cause)}`);
  process.exit(1);
}
