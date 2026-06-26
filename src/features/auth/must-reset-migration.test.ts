import { describe, expect, it } from "bun:test";
import { MUST_RESET_PASSWORD_KEY } from "./metadata";
import { decideMustResetMigration } from "./must-reset-migration";

const KEY = MUST_RESET_PASSWORD_KEY;

describe("decideMustResetMigration", () => {
  it("skip cuando app_metadata YA tiene la clave (true) — aunque user_metadata la tenga", () => {
    const d = decideMustResetMigration({
      app_metadata: { [KEY]: true },
      user_metadata: { [KEY]: true },
    });
    expect(d.action).toBe("skip");
  });

  it("skip cuando app_metadata YA tiene la clave en false (idempotencia)", () => {
    const d = decideMustResetMigration({ app_metadata: { [KEY]: false } });
    expect(d.action).toBe("skip");
  });

  it("skip cuando app_metadata tiene la clave como residuo null (no recalcula desde user_metadata)", () => {
    const d = decideMustResetMigration({
      app_metadata: { [KEY]: null },
      user_metadata: { [KEY]: true },
    });
    expect(d.action).toBe("skip");
  });

  it("skip cuando ninguna metadata tiene la clave", () => {
    const d = decideMustResetMigration({ app_metadata: {}, user_metadata: {} });
    expect(d.action).toBe("skip");
  });

  it("skip cuando app_metadata/user_metadata son null/undefined", () => {
    expect(decideMustResetMigration({}).action).toBe("skip");
    expect(decideMustResetMigration({ app_metadata: null, user_metadata: null }).action).toBe(
      "skip",
    );
  });

  it("migrate con flagValue true cuando solo user_metadata la tiene en true", () => {
    const d = decideMustResetMigration({ user_metadata: { [KEY]: true } });
    expect(d).toEqual({ action: "migrate", flagValue: true });
  });

  it("migrate con flagValue false cuando solo user_metadata la tiene en false", () => {
    const d = decideMustResetMigration({ user_metadata: { [KEY]: false } });
    expect(d).toEqual({ action: "migrate", flagValue: false });
  });

  it("migrate con flagValue false cuando user_metadata trae un valor no-booleano (=== true es estricto)", () => {
    const d = decideMustResetMigration({ user_metadata: { [KEY]: "true" } });
    expect(d).toEqual({ action: "migrate", flagValue: false });
  });
});
