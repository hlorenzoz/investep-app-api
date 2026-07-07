import { AppError } from "../../lib/errors";
import { throwPostgrestError, throwSupabaseAuthError } from "../../lib/postgres-error";
import type { SendEmailParams, SendEmailResult } from "../../lib/resend";
import { type AppSupabaseClient, POSTGREST_MAX_ROWS } from "../../lib/supabase";
import { IS_ADMIN_KEY, MUST_RESET_PASSWORD_KEY, resolveRole } from "../auth/metadata";
import { provisionUser } from "../auth/user-provisioning";

export interface UsersServiceDeps {
  admin: AppSupabaseClient;
}

export interface UsersServiceCreateDeps extends UsersServiceDeps {
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
}

export interface UserDTO {
  id: string;
  email: string;
  role: "admin" | "manager" | "user";
  fullName: string | null;
  createdAt: string;
  mustResetPassword: boolean;
  planSlug: string | null;
  phone: string | null;
  country: string | null;
}

/**
 * Lista todos los usuarios de Supabase Auth y los combina con sus perfiles de la DB y sus planes.
 */
export async function listUsers(deps: UsersServiceDeps): Promise<UserDTO[]> {
  // 1. Obtener usuarios de Supabase Auth (máximo 1000 por simplicidad y límites del Worker)
  const { data: authData, error: authError } = await deps.admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authError || !authData) {
    throw new AppError(
      "INTERNAL_ERROR",
      "No se pudo obtener el listado de usuarios de Auth.",
      502,
      undefined,
      { cause: authError },
    );
  }

  // 2. Obtener perfiles de la tabla profiles. Límite explícito alineado con el
  //    `perPage: 1000` del listado de Auth.
  const { data: profiles, error: profilesError } = await deps.admin
    .from("profiles")
    .select("id, full_name, phone, country")
    .limit(POSTGREST_MAX_ROWS);

  if (profilesError) {
    throw new AppError(
      "INTERNAL_ERROR",
      "No se pudieron obtener los perfiles de la base de datos.",
      502,
      undefined,
      { cause: profilesError },
    );
  }

  const profilesMap = new Map<
    string,
    { fullName: string | null; phone: string | null; country: string | null }
  >(
    (profiles ?? []).map((p) => [
      p.id,
      { fullName: p.full_name, phone: p.phone, country: p.country },
    ]),
  );

  // 3. Obtener membresías de academy_memberships. Mismo límite explícito que profiles.
  const { data: memberships, error: membershipsError } = await deps.admin
    .from("academy_memberships")
    .select("user_id, investep_plans(slug)")
    .eq("status", "active")
    .limit(POSTGREST_MAX_ROWS);

  if (membershipsError) {
    throw new AppError(
      "INTERNAL_ERROR",
      "No se pudieron obtener las membresías de la base de datos.",
      502,
      undefined,
      { cause: membershipsError },
    );
  }

  const membershipsMap = new Map<string, string | null>();
  for (const m of memberships ?? []) {
    const plan = m.investep_plans as unknown as { slug: string } | null;
    if (plan) {
      membershipsMap.set(m.user_id, plan.slug);
    }
  }

  // 4. Combinar todos los listados
  return authData.users.map((user) => {
    const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
    const profile = profilesMap.get(user.id);
    return {
      id: user.id,
      email: user.email ?? "",
      role: resolveRole(appMetadata),
      fullName: profile?.fullName ?? null,
      createdAt: user.created_at,
      mustResetPassword: appMetadata[MUST_RESET_PASSWORD_KEY] === true,
      planSlug: membershipsMap.get(user.id) ?? null,
      phone: profile?.phone ?? null,
      country: profile?.country ?? null,
    };
  });
}

/**
 * Obtiene un único usuario combinando Auth, Profile y Plan.
 */
export async function getUser(deps: UsersServiceDeps, id: string): Promise<UserDTO> {
  // 1. Obtener usuario de Auth
  const { data: authData, error: authError } = await deps.admin.auth.admin.getUserById(id);
  if (authError || !authData.user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado en la autenticación.", 404, undefined, {
      cause: authError,
    });
  }

  // 2. Obtener perfil
  const { data: profile, error: profileError } = await deps.admin
    .from("profiles")
    .select("full_name, phone, country")
    .eq("id", id)
    .maybeSingle();

  if (profileError) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Error al consultar el perfil en la base de datos.",
      502,
      undefined,
      { cause: profileError },
    );
  }

  // 3. Obtener membresía
  const { data: membership, error: membershipError } = await deps.admin
    .from("academy_memberships")
    .select("investep_plans(slug)")
    .eq("user_id", id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Error al consultar la membresía en la base de datos.",
      502,
      undefined,
      { cause: membershipError },
    );
  }

  const plan = membership?.investep_plans as unknown as { slug: string } | null;
  const planSlug = plan?.slug ?? null;

  const user = authData.user;
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;

  return {
    id: user.id,
    email: user.email ?? "",
    role: resolveRole(appMetadata),
    fullName: profile?.full_name ?? null,
    createdAt: user.created_at,
    mustResetPassword: appMetadata[MUST_RESET_PASSWORD_KEY] === true,
    planSlug,
    phone: profile?.phone ?? null,
    country: profile?.country ?? null,
  };
}

/**
 * Acción de plan ya resuelta y validada, lista para aplicar sin riesgo de fallo de validación.
 */
type PlanAction = { kind: "noop" } | { kind: "delete" } | { kind: "upsert"; planId: number };

/**
 * Resuelve y VALIDA el plan a partir del slug SIN mutar estado.
 *
 * Se invoca al principio del flujo (antes de aprovisionar/actualizar) para que un slug
 * inválido falle con 400 antes de tocar Auth, el perfil o enviar emails. De esta forma un
 * `VALIDATION_ERROR` nunca deja efectos colaterales a medio aplicar.
 */
async function resolvePlanAction(
  admin: AppSupabaseClient,
  planSlug: string | null | undefined,
): Promise<PlanAction> {
  if (planSlug === undefined) {
    return { kind: "noop" };
  }

  if (planSlug === null || planSlug === "") {
    return { kind: "delete" };
  }

  const { data: plan, error: planError } = await admin
    .from("investep_plans")
    .select("id")
    .eq("slug", planSlug)
    .maybeSingle();

  if (planError || !plan) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No se encontró el plan de la academia con slug: ${planSlug}`,
      400,
    );
  }

  return { kind: "upsert", planId: plan.id };
}

/**
 * Aplica una acción de plan ya resuelta. No valida ni puede producir un 400: se invoca al
 * final del flujo, cuando el resto de las mutaciones ya se aplicaron.
 */
async function applyPlanAction(admin: AppSupabaseClient, userId: string, action: PlanAction) {
  if (action.kind === "noop") {
    return;
  }

  if (action.kind === "delete") {
    // Sin filtro de status a propósito: `onConflict: "user_id"` garantiza una única fila
    // de membresía por usuario, así que borrar por user_id elimina la membresía vigente.
    const { error: deleteError } = await admin
      .from("academy_memberships")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      throwPostgrestError(
        deleteError,
        "No se pudo eliminar la membresía del usuario.",
        (deleteError as { status?: number }).status,
      );
    }
    return;
  }

  const { error: upsertError } = await admin.from("academy_memberships").upsert(
    {
      user_id: userId,
      investep_plan_id: action.planId,
      status: "active",
      source: "admin",
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
    },
  );

  if (upsertError) {
    throwPostgrestError(
      upsertError,
      "No se pudo asignar/actualizar la membresía del usuario.",
      (upsertError as { status?: number }).status,
    );
  }
}

/**
 * Aprovisiona un usuario de forma idempotente, setea su rol e inserta/actualiza su perfil y plan.
 */
export async function createUser(
  deps: UsersServiceCreateDeps,
  input: {
    email: string;
    fullName?: string | null;
    role: "admin" | "manager" | "user";
    password?: string;
    planSlug?: string | null;
    phone?: string | null;
    country?: string | null;
  },
): Promise<UserDTO> {
  // 0. Validar el plan ANTES de mutar nada: un slug inválido debe fallar con 400 sin
  //    haber creado el usuario ni enviado el email de credenciales.
  const planAction = await resolvePlanAction(deps.admin, input.planSlug);

  // 1. Aprovisionar usuario (creación / reset de contraseña y envío de email)
  const provisionResult = await provisionUser(
    { admin: deps.admin, sendEmail: deps.sendEmail },
    { email: input.email, password: input.password },
  );

  const userId = provisionResult.userId;

  // 2. Actualizar el rol en app_metadata
  const { error: updateAuthError } = await deps.admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      role: input.role,
      [IS_ADMIN_KEY]: input.role === "admin",
      is_manager: input.role === "manager",
    },
  });

  if (updateAuthError) {
    throwSupabaseAuthError(
      updateAuthError,
      "No se pudo configurar el rol del usuario.",
      "Los datos provistos son inválidos para configurar el rol.",
      (updateAuthError as { status?: number }).status,
    );
  }

  // 3. Crear/actualizar perfil en la DB (incluye phone/country del alta)
  const { error: profileError } = await deps.admin.from("profiles").upsert({
    id: userId,
    full_name: input.fullName ?? null,
    // `|| null` normaliza el string vacío a null (misma regla que updateUser).
    phone: input.phone || null,
    country: input.country || null,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    throwPostgrestError(
      profileError,
      "No se pudo crear el perfil del usuario en la base de datos.",
      (profileError as { status?: number }).status,
    );
  }

  // 3.5. Aplicar el plan ya resuelto (validado en el paso 0)
  await applyPlanAction(deps.admin, userId, planAction);

  // 4. Devolver la entidad de usuario completa y actualizada
  return getUser(deps, userId);
}

/**
 * Actualiza los campos de un usuario existente.
 */
export async function updateUser(
  deps: UsersServiceDeps,
  id: string,
  input: {
    email?: string;
    fullName?: string | null;
    role?: "admin" | "manager" | "user";
    password?: string;
    planSlug?: string | null;
    phone?: string | null;
    country?: string | null;
  },
): Promise<UserDTO> {
  // 1. Validar que el usuario exista
  const { data: authData, error: findError } = await deps.admin.auth.admin.getUserById(id);
  if (findError || !authData.user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.", 404, undefined, { cause: findError });
  }

  // 1.5. Validar el plan ANTES de mutar Auth/perfil: un slug inválido debe fallar con 400
  //      sin haber aplicado ninguna otra actualización.
  const planAction = await resolvePlanAction(deps.admin, input.planSlug);

  // 2. Actualizar Supabase Auth si es necesario. phone/country NO viven acá: son datos de
  //    perfil y se escriben en `profiles` (paso 3), no en Auth.
  const authUpdates: {
    email?: string;
    password?: string;
    app_metadata?: Record<string, unknown>;
  } = {};
  if (input.email) authUpdates.email = input.email;
  if (input.password) {
    authUpdates.password = input.password;
    authUpdates.app_metadata = {
      ...authData.user.app_metadata,
      [MUST_RESET_PASSWORD_KEY]: true,
    };
  }

  if (input.role) {
    authUpdates.app_metadata = {
      ...(authUpdates.app_metadata ?? authData.user.app_metadata),
      role: input.role,
      [IS_ADMIN_KEY]: input.role === "admin",
      is_manager: input.role === "manager",
    };
  }

  if (Object.keys(authUpdates).length > 0) {
    const { error: updateAuthError } = await deps.admin.auth.admin.updateUserById(id, authUpdates);
    if (updateAuthError) {
      throwSupabaseAuthError(
        updateAuthError,
        "Error al actualizar los datos en Supabase Auth.",
        "Los datos provistos no son válidos o la contraseña es muy débil.",
        (updateAuthError as { status?: number }).status,
      );
    }
  }

  // 3. Actualizar perfil si cambió algún dato de perfil (fullName/phone/country). El upsert
  //    incluye SOLO las claves presentes en el input (un `undefined` = "no tocar"), así un
  //    PATCH de phone no pisa el full_name existente.
  if (input.fullName !== undefined || input.phone !== undefined || input.country !== undefined) {
    const profilePatch: {
      id: string;
      updated_at: string;
      full_name?: string | null;
      phone?: string | null;
      country?: string | null;
    } = { id, updated_at: new Date().toISOString() };
    // `|| null` normaliza el string vacío a null: una sola representación de "sin dato".
    if (input.fullName !== undefined) profilePatch.full_name = input.fullName;
    if (input.phone !== undefined) profilePatch.phone = input.phone || null;
    if (input.country !== undefined) profilePatch.country = input.country || null;

    const { error: profileError } = await deps.admin.from("profiles").upsert(profilePatch);

    if (profileError) {
      throwPostgrestError(
        profileError,
        "Error al actualizar el perfil en la base de datos.",
        (profileError as { status?: number }).status,
      );
    }
  }

  // 3.5. Aplicar el plan ya resuelto (validado en el paso 1.5)
  await applyPlanAction(deps.admin, id, planAction);

  // 4. Retornar el usuario final
  return getUser(deps, id);
}

/**
 * Elimina un usuario por completo.
 */
export async function deleteUser(
  deps: UsersServiceDeps,
  id: string,
): Promise<{ success: boolean }> {
  // 1. Validar existencia
  const { data: authData, error: findError } = await deps.admin.auth.admin.getUserById(id);
  if (findError || !authData.user) {
    throw new AppError("NOT_FOUND", "Usuario no encontrado.", 404, undefined, { cause: findError });
  }

  // 2. Eliminar de Auth (disparará delete cascade en profiles por la FK)
  const { error: deleteError } = await deps.admin.auth.admin.deleteUser(id);
  if (deleteError) {
    throwPostgrestError(
      deleteError,
      "No se pudo eliminar el usuario de Supabase Auth.",
      (deleteError as { status?: number }).status,
    );
  }

  return { success: true };
}
