/**
 * Política de contraseñas para cambios iniciados por el usuario.
 *
 * Función pura: devuelve un mensaje de error si la contraseña NO cumple, o `null`
 * si es válida. No lanza ni depende de `AppError` a propósito, para poder testearla
 * en aislamiento (white-box, §11) y reusarla desde el servicio y futuros callers.
 * El servicio traduce el mensaje a `AppError("VALIDATION_ERROR", ..., 400)`.
 */

/** Longitud mínima exigida a una contraseña elegida por el usuario. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Valida la política de contraseñas.
 *
 * @returns Mensaje de error (apto para el cliente) si NO cumple; `null` si es válida.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}
