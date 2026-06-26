import { describe, expect, it } from "bun:test";
import { MIN_PASSWORD_LENGTH, validatePasswordPolicy } from "./password-policy";

describe("validatePasswordPolicy", () => {
  it("rechaza la contraseña vacía", () => {
    expect(validatePasswordPolicy("")).not.toBeNull();
  });

  it("rechaza por debajo del mínimo (MIN - 1 chars)", () => {
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
  });

  it("acepta exactamente el mínimo (borde inferior)", () => {
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("acepta por encima del mínimo", () => {
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH + 12))).toBeNull();
  });
});
