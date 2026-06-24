import { describe, expect, it } from "bun:test";
import { generatePassword, pickOne, randomInt } from "./password";

/**
 * Charset sin ambigüos definido en §2.1 del diseño:
 * - Mayúsculas: A-Z sin I, O
 * - Minúsculas: a-z sin i, l, o
 * - Dígitos: 2-9 (sin 0 y 1)
 * - Símbolos seguros
 */
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // A-Z sin I, O
const LOWERCASE = "abcdefghjkmnpqrstuvwxyz"; // a-z sin i, l, o
const DIGITS = "23456789"; // 0 y 1 excluidos
const SYMBOLS = "!@#$%^&*";
const FULL_CHARSET = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;
// Caracteres visualmente ambigüos: mayúsculas O/I, minúsculas i/l/o, dígitos 0/1
const AMBIGUOUS = new Set(["O", "0", "I", "l", "1", "i", "o"]);

describe("generatePassword", () => {
  it("1.1: la longitud del resultado es igual a la longitud solicitada (default 24)", () => {
    expect(generatePassword()).toHaveLength(24);
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(32)).toHaveLength(32);
  });

  it("1.2: cada carácter pertenece al charset sin ambigüos", () => {
    const password = generatePassword(100);
    for (const char of password) {
      expect(FULL_CHARSET).toContain(char);
    }
  });

  it("1.3: ningún carácter ambigüo aparece en 1000 generaciones consecutivas", () => {
    for (let i = 0; i < 1000; i++) {
      const password = generatePassword();
      for (const char of password) {
        expect(AMBIGUOUS.has(char)).toBe(false);
      }
    }
  });

  it("1.4: cada generación contiene al menos una mayúscula, minúscula, dígito y símbolo (50 veces)", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword();
      const hasUpper = [...password].some((c) => UPPERCASE.includes(c));
      const hasLower = [...password].some((c) => LOWERCASE.includes(c));
      const hasDigit = [...password].some((c) => DIGITS.includes(c));
      const hasSymbol = [...password].some((c) => SYMBOLS.includes(c));
      expect(hasUpper).toBe(true);
      expect(hasLower).toBe(true);
      expect(hasDigit).toBe(true);
      expect(hasSymbol).toBe(true);
    }
  });

  it("1.5: unicidad estadística — 1000 llamadas producen al menos 990 valores distintos", () => {
    const results = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      results.add(generatePassword());
    }
    expect(results.size).toBeGreaterThanOrEqual(990);
  });

  // #6 — randomInt con Uint32Array: soporta charsets de longitud > 256
  it("1.6: generatePassword(300) devuelve exactamente 300 caracteres sin colgarse", () => {
    const result = generatePassword(300);
    expect(result).toHaveLength(300);
  });

  // #9 — minúsculas sin i/o además de sin l
  it("1.7: ningún carácter ambigüo (O/0/I/l/1/i/o) aparece en 1000 generaciones", () => {
    for (let i = 0; i < 1000; i++) {
      const password = generatePassword();
      for (const char of password) {
        expect(AMBIGUOUS.has(char)).toBe(false);
      }
    }
  });

  // Fix B — guard length < 4
  it("B.1: generatePassword(3) lanza RangeError (length < 4 no satisface una clase por carácter)", () => {
    expect(() => generatePassword(3)).toThrow(RangeError);
  });

  it("B.2: generatePassword(0) lanza RangeError", () => {
    expect(() => generatePassword(0)).toThrow(RangeError);
  });

  it("B.3: generatePassword(4) devuelve exactamente 4 chars con al menos uno de cada clase", () => {
    // Ejecutar varias veces: con length=4 los 4 slots son los obligatorios (uno por clase)
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(4);
      expect(pw).toHaveLength(4);
      const hasUpper = [...pw].some((c) => UPPERCASE.includes(c));
      const hasLower = [...pw].some((c) => LOWERCASE.includes(c));
      const hasDigit = [...pw].some((c) => DIGITS.includes(c));
      const hasSymbol = [...pw].some((c) => SYMBOLS.includes(c));
      expect(hasUpper).toBe(true);
      expect(hasLower).toBe(true);
      expect(hasDigit).toBe(true);
      expect(hasSymbol).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix C — randomInt y pickOne exportados; guards internos
// ---------------------------------------------------------------------------

describe("randomInt", () => {
  it("C.1: randomInt(1) siempre devuelve 0", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomInt(1)).toBe(0);
    }
  });

  it("C.2: randomInt(n) para n > 1 devuelve entero en [0, n) a lo largo de 500 iteraciones", () => {
    const n = 10;
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = randomInt(n);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(n);
      seen.add(v);
    }
    // Con 500 muestras de [0,10) es estadísticamente improbable no ver al menos 8 valores distintos
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("C.3: randomInt(0) lanza RangeError", () => {
    expect(() => randomInt(0)).toThrow(RangeError);
  });

  it("C.4: randomInt(-1) lanza RangeError", () => {
    expect(() => randomInt(-1)).toThrow(RangeError);
  });

  it("C.5: randomInt(2.5) lanza RangeError (no entero)", () => {
    expect(() => randomInt(2.5)).toThrow(RangeError);
  });
});

describe("pickOne", () => {
  it("C.6: pickOne devuelve un carácter que pertenece al charset dado", () => {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (let i = 0; i < 50; i++) {
      const ch = pickOne(charset);
      expect(charset).toContain(ch);
    }
  });

  it("C.7: pickOne('') lanza RangeError (charset vacío → randomInt(0))", () => {
    expect(() => pickOne("")).toThrow(RangeError);
  });
});
