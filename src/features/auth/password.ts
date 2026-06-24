/**
 * Generación de contraseñas criptográficamente seguras.
 *
 * Usa Web Crypto (`crypto.getRandomValues`) disponible tanto en Cloudflare Workers
 * como en Bun, sin dependencias externas. Aplica rejection sampling para eliminar
 * sesgo de módulo y garantiza al menos un carácter de cada clase.
 */

/** Mayúsculas sin caracteres ambigüos (I y O excluidos). */
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
/** Minúsculas sin caracteres ambigüos (i, l y o excluidos). */
const LOWERCASE = "abcdefghjkmnpqrstuvwxyz";
/** Dígitos sin caracteres ambigüos (0 y 1 excluidos). */
const DIGITS = "23456789";
/** Símbolos seguros para contraseñas. */
const SYMBOLS = "!@#$%^&*";

/** Charset completo: unión de todas las clases sin ambigüos. */
const CHARSET = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

/**
 * Genera una contraseña criptográficamente segura.
 * El charset excluye caracteres visualmente ambigüos (O/0, I/l/1).
 * Garantiza al menos un carácter de cada clase: mayúsculas, minúsculas,
 * dígitos y símbolos. Usa rejection sampling para eliminar sesgo de módulo.
 *
 * @param length - Longitud total de la contraseña generada. Por defecto: 24.
 *   Mínimo: 4 (una por cada clase de carácter). Valores menores lanzan `RangeError`.
 * @returns Una cadena de exactamente `length` caracteres.
 * @throws {RangeError} Si `length` es menor que 4.
 */
export function generatePassword(length = 24): string {
  if (length < 4) {
    throw new RangeError(
      "La longitud mínima de la contraseña es 4 (una por cada clase de carácter).",
    );
  }
  // Garantía de clase: elige uno aleatorio de cada clase
  const mandatory: string[] = [
    pickOne(UPPERCASE),
    pickOne(LOWERCASE),
    pickOne(DIGITS),
    pickOne(SYMBOLS),
  ];

  // Rellena el resto con caracteres del charset completo
  const remaining: string[] = [];
  const fillCount = length - mandatory.length;
  for (let i = 0; i < fillCount; i++) {
    remaining.push(pickOne(CHARSET));
  }

  // Mezcla in-place Fisher-Yates para evitar que la posición delate la clase
  const combined = [...mandatory, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    // biome-ignore lint/style/noNonNullAssertion: índice controlado por el loop
    [combined[i], combined[j]] = [combined[j]!, combined[i]!];
  }

  return combined.join("");
}

/**
 * Devuelve un entero aleatorio en [0, max) libre de sesgo de módulo.
 * Usa rejection sampling con Uint32Array (32 bits) para soportar charsets
 * de cualquier tamaño razonable sin loop infinito cuando max > 256.
 *
 * Exportado para white-box testing (§11 de AGENTS.md). No re-exportar desde el
 * feature boundary (`src/features/auth/index.ts`): es un interno del módulo.
 *
 * @param max - Cota superior exclusiva. Debe ser un entero >= 1.
 * @throws {RangeError} Si `max` no es un entero >= 1.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("randomInt requiere un entero max >= 1.");
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    // biome-ignore lint/style/noNonNullAssertion: buf siempre tiene un elemento
    value = buf[0]!;
  } while (value >= limit);
  return value % max;
}

/**
 * Elige un carácter aleatorio del charset dado usando rejection sampling.
 *
 * Exportado para white-box testing (§11 de AGENTS.md). No re-exportar desde el
 * feature boundary (`src/features/auth/index.ts`).
 *
 * @param charset - Cadena de al menos 1 carácter.
 * @throws {RangeError} Si `charset` está vacío (delega en `randomInt(0)`).
 */
export function pickOne(charset: string): string {
  // biome-ignore lint/style/noNonNullAssertion: índice siempre < charset.length por el rejection sampling
  return charset[randomInt(charset.length)]!;
}
