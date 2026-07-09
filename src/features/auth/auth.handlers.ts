import type { RouteHandler } from "@hono/zod-openapi";
import { logError } from "../../lib/log";
import { throwPostgrestError } from "../../lib/postgres-error";
import { type AppSupabaseClient, createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { Env } from "../../types/env";
import {
  fetchProfile,
  type ProfileFields,
  saveProfile,
  toProfileFields,
} from "../profiles/profiles.repository";
import type { ChangePasswordRoute, MeRoute, UpdateProfileRoute } from "./auth.routes";
import { changePassword } from "./change-password";

const EMPTY_PROFILE: ProfileFields = { fullName: null, phone: null, country: null };

/**
 * Lee el perfil de forma RESILIENTE: cualquier fallo (error de PostgREST o excepción de red)
 * degrada a un perfil vacío y deja rastro (§12), para que `/me` nunca caiga por el perfil.
 */
async function loadProfileSafe(admin: AppSupabaseClient, id: string): Promise<ProfileFields> {
  try {
    const { data, error } = await fetchProfile(admin, id);
    if (error) {
      logError("profile_lookup_failed", { userId: id, cause: error.code ?? error.message });
      return EMPTY_PROFILE;
    }
    return toProfileFields(data);
  } catch (err) {
    logError("profile_lookup_failed", {
      userId: id,
      cause: err instanceof Error ? err.name : "unknown",
    });
    return EMPTY_PROFILE;
  }
}

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
 * así que el handler solo lo proyecta a la respuesta enriqueciéndolo con datos del perfil y plan.
 */
export const meHandler: RouteHandler<MeRoute, AuthedBindings> = async (c) => {
  const { id, email, mustResetPassword, role } = c.get("user");
  const supabase = createSupabaseAdminClient(c.env);

  // El plan y el perfil son lookups independientes → en paralelo (es un endpoint caliente
  // que el cliente llama en cada hidratación de sesión).
  const [planSlug, profile] = await Promise.all([
    getPlanSlug(c.env, id),
    loadProfileSafe(supabase, id),
  ]);

  return c.json({ user: { id, email, mustResetPassword, role, planSlug, ...profile } }, 200);
};

/**
 * PATCH /auth/profile — permite al usuario autenticado actualizar su propio perfil
 * (fullName, phone, country) en la tabla `profiles`.
 */
export const updateProfileHandler: RouteHandler<UpdateProfileRoute, AuthedBindings> = async (c) => {
  const { id, email, mustResetPassword, role } = c.get("user");
  const body = c.req.valid("json");
  const supabase = createSupabaseAdminClient(c.env);

  // La escritura del perfil y la lectura del plan son independientes → en paralelo.
  // `saveProfile` devuelve la fila fusionada (upsert + select en un round-trip), así que
  // la respuesta sale del propio retorno de la escritura, sin una relectura separada.
  const [saveResult, planSlug] = await Promise.all([
    saveProfile(supabase, id, {
      fullName: body.fullName,
      phone: body.phone,
      country: body.country,
    }),
    getPlanSlug(c.env, id),
  ]);

  if (saveResult.error) {
    throwPostgrestError(
      saveResult.error,
      "Error al actualizar el perfil en la base de datos.",
      (saveResult.error as { status?: number }).status,
    );
  }

  return c.json(
    {
      user: {
        id,
        email,
        mustResetPassword,
        role,
        planSlug,
        ...toProfileFields(saveResult.data),
      },
    },
    200,
  );
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
