import { describe, expect, it } from "bun:test";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppBindings } from "../types/app";
import { validationHook } from "./openapi";

/** App de prueba con una ruta que valida query, usando el validationHook real. */
function appWithValidation() {
  const app = new OpenAPIHono<AppBindings>({ defaultHook: validationHook<AppBindings>() });
  const route = createRoute({
    method: "get",
    path: "/echo",
    request: { query: z.object({ n: z.coerce.number().int() }) },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ n: z.number() }) } },
        description: "ok",
      },
    },
  });
  return app.openapi(route, (c) => c.json({ n: c.req.valid("query").n }, 200));
}

describe("validationHook", () => {
  it("deja pasar la entrada válida", async () => {
    const res = await appWithValidation().request("/echo?n=5");
    expect(res.status).toBe(200);
    expect((await res.json()) as { n: number }).toEqual({ n: 5 });
  });

  it("entrada inválida → 422 con el formato de error único y details", async () => {
    const res = await appWithValidation().request("/echo?n=abc");
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("La solicitud no es válida.");
    expect(body.error.details).toBeDefined();
  });
});
