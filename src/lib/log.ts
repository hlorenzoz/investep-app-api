/**
 * Logging estructurado para el runtime del Worker (AGENTS.md §12, CRÍTICO — fintech).
 *
 * La observabilidad de Workers (`observability.enabled` en `wrangler.jsonc`) captura
 * stdout/stderr y, si la línea es JSON, la indexa por campo. Por eso emitimos UNA línea
 * JSON por evento: `event` es el discriminante (filtrable/alertable) y `context` agrega
 * datos NO sensibles para correlación. Esto es lo que pide §12 frente a un `console.*`
 * con string suelto: un evento como un plan huérfano se vuelve rastreable, no ruido.
 *
 * NUNCA pasar datos sensibles (§5): tokens, credenciales, JWTs, ni datos de cuenta/cartera
 * identificables. El llamador sanitiza antes de loguear.
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

/** Emite un evento de error estructurado (una línea JSON). Prioriza errores y eventos de seguridad (§12). */
export function logError(event: string, context?: LogContext): void {
  console.error(JSON.stringify({ level: "error", event, ...context }));
}

/** Emite un evento de advertencia estructurado (una línea JSON). Para degradaciones no fatales
 * (p. ej. un binding opcional ausente) que deben ser visibles en observabilidad sin cortar tráfico. */
export function logWarn(event: string, context?: LogContext): void {
  console.warn(JSON.stringify({ level: "warn", event, ...context }));
}
