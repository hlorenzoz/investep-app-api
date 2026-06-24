import { describe, expect, it } from "bun:test";
import { AppError, toErrorResponse } from "./errors";

describe("AppError", () => {
  it("guarda code, status, message y details", () => {
    const err = new AppError("NOT_FOUND", "no existe", 404, { id: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("no existe");
    expect(err.details).toEqual({ id: 1 });
  });

  it("permite omitir details", () => {
    const err = new AppError("INTERNAL_ERROR", "boom", 500);
    expect(err.details).toBeUndefined();
  });
});

describe("toErrorResponse", () => {
  it("incluye details cuando se pasan", () => {
    expect(toErrorResponse("VALIDATION_ERROR", "inválido", [{ path: "x" }])).toEqual({
      error: { code: "VALIDATION_ERROR", message: "inválido", details: [{ path: "x" }] },
    });
  });

  it("omite la clave details cuando es undefined", () => {
    const body = toErrorResponse("CONFLICT", "duplicado");
    expect(body).toEqual({ error: { code: "CONFLICT", message: "duplicado" } });
    expect("details" in body.error).toBe(false);
  });
});
