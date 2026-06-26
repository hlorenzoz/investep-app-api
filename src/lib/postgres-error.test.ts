import { describe, expect, it } from "bun:test";
import { AppError } from "./errors";
import {
  isTransientPostgrestError,
  throwPostgrestError,
  throwSupabaseAuthError,
} from "./postgres-error";

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

describe("throwSupabaseAuthError", () => {
  const VALIDATION_MSG = "La contraseña no es válida.";
  const INTERNAL_MSG = "No se pudo cambiar la contraseña.";

  for (const status of [400, 422]) {
    it(`status ${status} (input rechazado por GoTrue) → 400 VALIDATION_ERROR con validationMessage`, () => {
      try {
        throwSupabaseAuthError({ message: "weak" }, INTERNAL_MSG, VALIDATION_MSG, status);
        throw new Error("debería haber lanzado");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("VALIDATION_ERROR");
        expect((err as AppError).status).toBe(400);
        expect((err as AppError).message).toBe(VALIDATION_MSG);
      }
    });
  }

  for (const status of [undefined, 0, 429, 500, 503]) {
    it(`status ${status} (transitorio) → 503 SERVICE_UNAVAILABLE`, () => {
      try {
        throwSupabaseAuthError({ message: "boom" }, INTERNAL_MSG, VALIDATION_MSG, status);
        throw new Error("debería haber lanzado");
      } catch (err) {
        expect((err as AppError).code).toBe("SERVICE_UNAVAILABLE");
        expect((err as AppError).status).toBe(503);
      }
    });
  }

  it("status 404 (genuino no-input, no-transitorio) → 500 INTERNAL_ERROR con userMessage", () => {
    try {
      throwSupabaseAuthError({ message: "not found" }, INTERNAL_MSG, VALIDATION_MSG, 404);
      throw new Error("debería haber lanzado");
    } catch (err) {
      expect((err as AppError).code).toBe("INTERNAL_ERROR");
      expect((err as AppError).status).toBe(500);
      expect((err as AppError).message).toBe(INTERNAL_MSG);
    }
  });

  it("el cause viaja en err.cause, nunca en details", () => {
    const cause = { message: "raw", status: 422 };
    try {
      throwSupabaseAuthError(cause, INTERNAL_MSG, VALIDATION_MSG, 422);
    } catch (err) {
      expect((err as AppError).cause).toBe(cause);
      expect((err as AppError).details).toBeUndefined();
    }
  });
});
