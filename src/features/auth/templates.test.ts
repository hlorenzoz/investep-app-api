import { describe, expect, it } from "bun:test";
import { credentialEmail } from "./templates";

describe("credentialEmail", () => {
  const INPUT = { email: "usuario@ejemplo.com", password: "Abc$2XmP!kR9" };

  it("3.1: devuelve un objeto con subject, html y text no vacíos", () => {
    const result = credentialEmail(INPUT);
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("3.2: html y text contienen la contraseña literal pasada como input", () => {
    const result = credentialEmail(INPUT);
    expect(result.html).toContain(INPUT.password);
    expect(result.text).toContain(INPUT.password);
  });

  it("3.3: html y text contienen una advertencia de seguridad en español", () => {
    const result = credentialEmail(INPUT);
    // La advertencia debe instruir al usuario a cambiar su contraseña de inmediato
    expect(result.html).toContain("inmediatamente");
    expect(result.text).toContain("inmediatamente");
  });

  it("3.4 triangulación: funciona con distintos emails y passwords", () => {
    const other = { email: "otro@dominio.org", password: "Z9!wQr#mNp$X" };
    const result = credentialEmail(other);
    expect(result.html).toContain(other.email);
    expect(result.html).toContain(other.password);
    expect(result.text).toContain(other.email);
    expect(result.text).toContain(other.password);
  });

  // #4 — HTML escaping: caracteres especiales no corrompen el HTML
  it("3.5: password con '&' y '<' → html escapa a '&amp;' y '&lt;', text los deja crudos", () => {
    const special = { email: "test@example.com", password: "P&ss<w0rd" };
    const result = credentialEmail(special);
    // HTML debe contener las entidades escapadas, no los caracteres crudos
    expect(result.html).toContain("&amp;");
    expect(result.html).toContain("&lt;");
    expect(result.html).not.toContain("P&ss<w0rd");
    // text es texto plano: los chars crudos se preservan
    expect(result.text).toContain("P&ss<w0rd");
  });
});
