import { createApp } from "./app";
import type { Env } from "./types/env";

/**
 * Entrypoint para Bun (Docker local / integración con Flutter).
 *
 * OJO: en producción el runtime es Cloudflare Workers (workerd), vía src/index.ts.
 * Acá servimos la MISMA app Hono sobre Bun, inyectando las variables de entorno
 * como bindings (process.env → c.env). Es un entorno de integración local, NO un
 * mirror exacto de Workers: los bindings nativos (KV, R2) no existen en Bun.
 */
const app = createApp();

export default {
  port: Number(process.env.PORT ?? 8787),
  fetch(request: Request) {
    return app.fetch(request, process.env as unknown as Env);
  },
};
