import { createApp } from "./app";
import type { Env } from "./types/env";

const app = createApp();

export default {
  fetch: app.fetch,

  // Punto de extensión para Cron Triggers (AGENTS.md §3/§6): los refrescos de cartera
  // van acá o en Queues, NUNCA bloqueando el handler de una request.
  // async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {},
} satisfies ExportedHandler<Env>;
