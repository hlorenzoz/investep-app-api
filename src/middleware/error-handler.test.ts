import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError } from "../lib/errors";
import type { AppBindings } from "../types/app";
import { errorHandler } from "./error-handler";

/** Mini app que lanza `err` en GET /boom y delega en el errorHandler global. */
function appThatThrows(err: unknown) {
  const app = new Hono<AppBindings>();
  app.onError(errorHandler);
  app.get("/boom", () => {
    throw err;
  });
  return app;
}

describe("errorHandler", () => {
  it("AppError → status y cuerpo del error de dominio (con details)", async () => {
    const res = await appThatThrows(new AppError("NOT_FOUND", "no existe", 404, { id: 1 })).request(
      "/boom",
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: unknown }).toEqual({
      error: { code: "NOT_FOUND", message: "no existe", details: { id: 1 } },
    });
  });

  it("HTTPException → mapea cada status a su code (incluido el default)", async () => {
    const cases = [
      [401, "UNAUTHORIZED"],
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [422, "INTERNAL_ERROR"], // status no mapeado → default
    ] as const;

    for (const [status, code] of cases) {
      const res = await appThatThrows(new HTTPException(status, { message: "x" })).request("/boom");
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    }
  });

  it("AppError 5xx con cause → loguea app_error con code/hint value-free, sin texto libre (§5)", async () => {
    const spy = mock((_line: string) => {});
    const original = console.error;
    console.error = spy;
    try {
      const cause = {
        code: "PGRST205",
        message: "Could not find the table 'public.trade_operations' in the schema cache",
        hint: "reload schema",
        details: "valor de fila sensible",
      };
      const res = await appThatThrows(
        new AppError("INTERNAL_ERROR", "No se pudieron leer las operaciones.", 500, undefined, {
          cause,
        }),
      ).request("/boom");

      expect(res.status).toBe(500);
      // El cliente NUNCA ve el cause interno.
      expect(JSON.stringify(await res.json())).not.toContain("PGRST205");
      // Se logueó una línea estructurada con el cause: code + hint (value-free).
      expect(spy).toHaveBeenCalled();
      const firstCall = spy.mock.calls[0];
      expect(firstCall).toBeDefined();
      const logged = JSON.parse(String(firstCall?.[0])) as Record<string, unknown>;
      expect(logged.event).toBe("app_error");
      expect(logged.code).toBe("INTERNAL_ERROR");
      expect(logged.status).toBe(500);
      expect(logged.cause_code).toBe("PGRST205");
      expect(logged.cause_hint).toBe("reload schema");
      // §5: NO se loguea texto libre (message/details), que puede embeber valores de fila.
      expect(logged.cause_message).toBeUndefined();
      expect(JSON.stringify(logged)).not.toContain("trade_operations");
      expect(JSON.stringify(logged)).not.toContain("valor de fila sensible");
    } finally {
      console.error = original;
    }
  });

  it("AppError 5xx con cause = Error nativo → loguea solo el name, nunca el message", async () => {
    const spy = mock((_line: string) => {});
    const original = console.error;
    console.error = spy;
    try {
      const cause = new TypeError("token=abc123 secreto en el message");
      await appThatThrows(
        new AppError("INTERNAL_ERROR", "boom", 500, undefined, { cause }),
      ).request("/boom");
      const firstCall = spy.mock.calls[0];
      expect(firstCall).toBeDefined();
      const logged = JSON.parse(String(firstCall?.[0])) as Record<string, unknown>;
      expect(logged.cause_code).toBe("TypeError");
      expect(JSON.stringify(logged)).not.toContain("token=abc123");
    } finally {
      console.error = original;
    }
  });

  it("AppError 4xx esperado → no loguea (evita ruido)", async () => {
    const spy = mock((_line: string) => {});
    const original = console.error;
    console.error = spy;
    try {
      const res = await appThatThrows(new AppError("NOT_FOUND", "no existe", 404)).request("/boom");
      expect(res.status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      console.error = original;
    }
  });

  it("Error inesperado → 500 genérico, sin filtrar internals al cliente", async () => {
    const spy = mock(() => {});
    const original = console.error;
    console.error = spy;
    try {
      const res = await appThatThrows(new Error("stack secreto interno")).request("/boom");
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("Ocurrió un error inesperado.");
      expect(JSON.stringify(body)).not.toContain("stack secreto interno");
      expect(spy).toHaveBeenCalled();
    } finally {
      console.error = original;
    }
  });
});
