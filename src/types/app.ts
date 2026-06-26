import type { Env } from "./env";

/**
 * Usuario autenticado, derivado del JWT de Supabase que valida el middleware
 * `requireAuth`. Es la proyección mínima que la API expone al cliente: nunca
 * incluye datos sensibles ni el token crudo (AGENTS.md §5).
 */
export interface AuthUser {
  id: string;
  email: string;
  /** `app_metadata.must_reset_password` (control de seguridad server-side): el frontend debe forzar el cambio. */
  mustResetPassword: boolean;
  /** `app_metadata.is_admin` (control de seguridad server-side): habilita el CRUD de catálogos vía `requireAdmin`. */
  isAdmin: boolean;
}

/**
 * Tipado base de la app Hono: expone los bindings del Worker en `c.env`.
 * NO declara `user` — eso es exclusivo de las rutas protegidas (ver
 * `AuthedBindings`), para que una ruta abierta no pueda leer `c.get("user")`
 * (sería `undefined` en runtime) sin que el compilador lo marque.
 */
export interface AppBindings {
  Bindings: Env;
}

/**
 * Bindings para rutas envueltas por `requireAuth`. Agrega `user` y el `accessToken`
 * crudo al contexto; el middleware garantiza que ambos estén presentes antes de
 * ejecutar el handler. `accessToken` lo necesitan las rutas que operan sobre la
 * sesión (p. ej. revocar sesiones tras cambiar la contraseña) sin re-parsear el header.
 */
export interface AuthedBindings {
  Bindings: Env;
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
}
