import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { ChangePasswordRoute, MeRoute } from "./auth.routes";
import { changePassword } from "./change-password";

/**
 * GET /auth/me — el usuario ya fue validado y cargado por `requireAuth`,
 * así que el handler solo lo proyecta a la respuesta.
 */
export const meHandler: RouteHandler<MeRoute, AuthedBindings> = (c) => {
  const { id, email, mustResetPassword } = c.get("user");
  // Proyección explícita: `isAdmin` es un control interno (lo consume `requireAdmin`),
  // NO parte del contrato público de `/auth/me`. No se filtra al cliente (§5).
  return c.json({ user: { id, email, mustResetPassword } }, 200);
};

/**
 * POST /auth/change-password — cambia la contraseña del usuario autenticado y apaga
 * `must_reset_password`. El userId/email salen del token (no del body). El admin client
 * se arma por request (Workers: sin estado, §3). El access token lo dejó `requireAuth`
 * en el contexto; se usa para revocar globalmente las sesiones tras el cambio.
 */
export const changePasswordHandler: RouteHandler<ChangePasswordRoute, AuthedBindings> = async (
  c,
) => {
  const { newPassword } = c.req.valid("json");
  const user = c.get("user");

  const result = await changePassword(
    { admin: createSupabaseAdminClient(c.env) },
    { userId: user.id, email: user.email, newPassword, accessToken: c.get("accessToken") },
  );

  return c.json(result, 200);
};
