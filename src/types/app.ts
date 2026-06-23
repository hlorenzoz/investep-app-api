import type { Env } from "./env";

/** Tipado base de la app Hono: expone los bindings del Worker en `c.env`. */
export interface AppBindings {
  Bindings: Env;
}
