import { describe, expect, it } from "bun:test";
import { AppError } from "./errors";
import { isTransientPostgrestError, throwPostgrestError } from "./postgres-error";

describe("isTransientPostgrestError", () => {
  it("es transitorio: undefined / 0 (red caída), 429 (throttling), 5xx (Supabase caído)", () => {
    expect(isTransientPostgrestError(undefined)).toBe(true);
    expect(isTransientPostgrestError(0)).toBe(true);
    expect(isTransientPostgrestError(429)).toBe(true);
    expect(isTransientPostgrestError(500)).toBe(true);
    expect(isTransientPostgrestError(503)).toBe(true);
  });

  it("NO es transitorio: 4xx genuinos ni 2xx", () => {
    expect(isTransientPostgrestError(400)).toBe(false);
    expect(isTransientPostgrestError(404)).toBe(false);
    expect(isTransientPostgrestError(409)).toBe(false);
    expect(isTransientPostgrestError(200)).toBe(false);
  });
});

describe("throwPostgrestError", () => {
  it("transitorio (5xx) → AppError SERVICE_UNAVAILABLE 503", () => {
    try {
      throwPostgrestError({ message: "boom" }, "No se pudo leer.", 500);
      throw new Error("debería haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("SERVICE_UNAVAILABLE");
      expect((err as AppError).status).toBe(503);
    }
  });

  it("transitorio sin status (red caída / undefined) → 503", () => {
    expect(() => throwPostgrestError({}, "msg")).toThrow(AppError);
    try {
      throwPostgrestError({}, "msg");
    } catch (err) {
      expect((err as AppError).status).toBe(503);
    }
  });

  it("genuino (4xx) → AppError INTERNAL_ERROR 500 con el userMessage", () => {
    try {
      throwPostgrestError({ message: "bad request" }, "No se pudo leer el capital.", 400);
      throw new Error("debería haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INTERNAL_ERROR");
      expect((err as AppError).status).toBe(500);
      expect((err as AppError).message).toBe("No se pudo leer el capital.");
    }
  });

  it("el cause viaja en err.cause (diagnóstico), NUNCA en details (no se filtra al cliente)", () => {
    const cause = { message: "raw pg detail", hint: "secret-ish" };
    try {
      throwPostgrestError(cause, "mensaje público", 400);
    } catch (err) {
      expect((err as AppError).cause).toBe(cause);
      expect((err as AppError).details).toBeUndefined();
    }
  });
});
