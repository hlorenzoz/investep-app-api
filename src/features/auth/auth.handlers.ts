import type { RouteHandler } from "@hono/zod-openapi";
import { logError } from "../../lib/log";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { Env } from "../../types/env";
import type { ChangePasswordRoute, MeRoute } from "./auth.routes";
import { changePassword } from "./change-password";

/**
 * Resuelve el slug del plan investep activo del usuario. Es un lookup SECUNDARIO:
 * si falla, degradamos a `null` para no tumbar `/me`, pero SIEMPRE dejamos rastro
 * (§12) — un fallo silencioso haría que un usuario con plan parezca sin plan, y sería
 * imposible de diagnosticar. Nunca se propaga el crudo de Supabase al cliente (§5).
 */
async function getPlanSlug(env: Env, userId: string): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient(env);
    const { data, error } = await supabase
      .from("academy_memberships")
      .select("investep_plans (slug)")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      logError("plan_slug_lookup_failed", { userId, cause: error.code ?? error.message });
      return null;
    }

    // El embed es many-to-one (una membresía → un plan): PostgREST devuelve un objeto,
    // nunca un array. El cast puentea los tipos generados del embed.
    const plan = data?.investep_plans as unknown as { slug: string } | null;
    if (plan) {
      return plan.slug;
    }
  } catch (err) {
    logError("plan_slug_lookup_failed", {
      userId,
      cause: err instanceof Error ? err.name : "unknown",
    });
  }
  return null;
}

/**
 * GET /auth/me — el usuario ya fue validado y cargado por `requireAuth`,
 * así que el handler solo lo proyecta a la respuesta.
 */
export const meHandler: RouteHandler<MeRoute, AuthedBindings> = async (c) => {
  const { id, email, mustResetPassword, role } = c.get("user");
  const planSlug = await getPlanSlug(c.env, id);
  return c.json({ user: { id, email, mustResetPassword, role, planSlug } }, 200);
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
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      newPassword,
      accessToken: c.get("accessToken"),
    },
  );

  // No enriquecemos con planSlug: este endpoint revoca todas las sesiones, así que el
  // cliente re-loguea y `/auth/me` resuelve el plan fresco. Un lookup acá sería trabajo tirado.
  return c.json(result, 200);
};
