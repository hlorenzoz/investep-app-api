import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { loadDevVars, makeAdminFromVars } from "../scripts/_env";

// loadDevVars resuelve rutas relativas al cwd; usamos un env de nombre único y lo limpiamos.
const FIXTURE_ENV = "spectest-env-helpers";
const FIXTURE_PATH = `.dev.vars.${FIXTURE_ENV}`;

afterAll(() => {
  if (existsSync(FIXTURE_PATH)) unlinkSync(FIXTURE_PATH);
});

describe("makeAdminFromVars", () => {
  it("lanza si faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() => makeAdminFromVars({})).toThrow();
    expect(() => makeAdminFromVars({ SUPABASE_URL: "http://x" })).toThrow();
    expect(() => makeAdminFromVars({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow();
  });

  it("construye un cliente admin cuando las vars están presentes", () => {
    const admin = makeAdminFromVars({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(admin.auth.admin).toBeDefined();
  });
});

describe("loadDevVars", () => {
  it("devuelve {} cuando el archivo no existe", () => {
    expect(loadDevVars("nonexistent-env-xyz")).toEqual({});
  });

  it("parsea KEY=VALUE, ignora comentarios y líneas sin '=', y saca comillas", () => {
    writeFileSync(
      FIXTURE_PATH,
      [
        "# comentario",
        "",
        "PLAIN=valor",
        'QUOTED="con espacios"',
        "SINGLE='comilla simple'",
        "linea-sin-igual",
        "WITH_EQ=a=b",
      ].join("\n"),
    );

    const vars = loadDevVars(FIXTURE_ENV);

    expect(vars.PLAIN).toBe("valor");
    expect(vars.QUOTED).toBe("con espacios");
    expect(vars.SINGLE).toBe("comilla simple");
    expect(vars.WITH_EQ).toBe("a=b");
    expect(vars["linea-sin-igual"]).toBeUndefined();
  });
});
