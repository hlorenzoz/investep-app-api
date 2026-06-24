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
