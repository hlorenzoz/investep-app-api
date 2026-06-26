import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { changePassword } from "./change-password";
import { MIN_PASSWORD_LENGTH } from "./password-policy";

// ---------------------------------------------------------------------------
// Tipos auxiliares y factory de admin mock (mismo patrón que user-provisioning.test.ts)
// ---------------------------------------------------------------------------

interface SupabaseResult<T> {
  data: T;
  error: null | { message: string; status?: number };
}

interface AdminApi {
  updateUserById: (id: string, opts: unknown) => Promise<SupabaseResult<{ user: unknown }>>;
  signOut: (
    jwt: string,
    scope?: string,
  ) => Promise<{ data: null; error: null | { message: string } }>;
}

function makeAdmin(overrides: Partial<AdminApi> = {}) {
  return {
    auth: {
      admin: {
        updateUserById: mock(
          async () =>
            ({
              data: { user: { id: "uid-1", email: "u@example.com" } },
              error: null,
            }) as SupabaseResult<{ user: unknown }>,
        ),
        signOut: mock(async () => ({ data: null, error: null })),
        ...overrides,
      },
    },
  };
}

type AdminDep = Parameters<typeof changePassword>[0]["admin"];

const BASE_INPUT = {
  userId: "uid-1",
  email: "u@example.com",
  newPassword: "a".repeat(MIN_PASSWORD_LENGTH),
  accessToken: "the-access-token",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("changePassword", () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("rechaza contraseña débil con 400 y NO llama a Supabase", async () => {
    const admin = makeAdmin();

    await expect(
      changePassword(
        { admin: admin as unknown as AdminDep },
        { ...BASE_INPUT, newPassword: "a".repeat(MIN_PASSWORD_LENGTH - 1) },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(0);
  });

  it("happy: updateUserById recibe password + app_metadata.must_reset_password=false; signOut global; retorna user con mustResetPassword=false", async () => {
    let capturedUpdate: unknown;
    let signOutCall: [string, string?] | undefined;
    const admin = makeAdmin({
      updateUserById: mock(async (_id: string, opts: unknown) => {
        capturedUpdate = opts;
        return {
          data: { user: { id: "uid-1", email: "u@example.com" } },
          error: null,
        } as SupabaseResult<{ user: unknown }>;
      }),
      signOut: mock(async (jwt: string, scope?: string) => {
        signOutCall = [jwt, scope];
        return { data: null, error: null };
      }),
    });

    const result = await changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT);

    const update = capturedUpdate as {
      password: string;
      app_metadata: { must_reset_password: boolean };
    };
    expect(update.password).toBe(BASE_INPUT.newPassword);
    expect(update.app_metadata.must_reset_password).toBe(false);

    // Revocación global con el access token del request (no userId).
    expect(signOutCall).toEqual([BASE_INPUT.accessToken, "global"]);

    expect(result.user).toEqual({ id: "uid-1", email: "u@example.com", mustResetPassword: false });
  });

  it("error transitorio de Supabase (status 500) → 503 SERVICE_UNAVAILABLE y NO revoca sesiones", async () => {
    const admin = makeAdmin({
      updateUserById: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "boom", status: 500 },
          }) as unknown as SupabaseResult<{ user: unknown }>,
      ),
    });

    await expect(
      changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });

    // La clave no cambió → no se revocan sesiones (signOut nunca se invoca).
    expect(admin.auth.admin.signOut).toHaveBeenCalledTimes(0);
  });

  it("GoTrue rechaza la contraseña (status 422: débil/igual a la anterior) → 400 VALIDATION_ERROR", async () => {
    const admin = makeAdmin({
      updateUserById: mock(
        async () =>
          ({
            data: { user: null },
            error: {
              message: "New password should be different from the old password",
              status: 422,
            },
          }) as unknown as SupabaseResult<{ user: unknown }>,
      ),
    });

    await expect(
      changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("GoTrue bad request (status 400) → 400 VALIDATION_ERROR", async () => {
    const admin = makeAdmin({
      updateUserById: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "bad request", status: 400 },
          }) as unknown as SupabaseResult<{ user: unknown }>,
      ),
    });

    await expect(
      changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("error genuino no-input ni transitorio (status 404) → 500 INTERNAL_ERROR", async () => {
    const admin = makeAdmin({
      updateUserById: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "user not found", status: 404 },
          }) as unknown as SupabaseResult<{ user: unknown }>,
      ),
    });

    await expect(
      changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
  });

  it("fallo en la revocación de sesiones → igual resuelve 200 (best-effort)", async () => {
    const admin = makeAdmin({
      signOut: mock(async () => ({ data: null, error: { message: "logout failed" } })),
    });

    const result = await changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT);

    expect(result.user.mustResetPassword).toBe(false);
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
  });

  it("signOut que lanza excepción → igual resuelve 200 (best-effort)", async () => {
    const admin = makeAdmin({
      signOut: mock(async () => {
        throw new Error("network down");
      }),
    });

    const result = await changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT);

    expect(result.user.mustResetPassword).toBe(false);
  });

  it("nunca registra el access token en console.error", async () => {
    const admin = makeAdmin({
      signOut: mock(async () => ({ data: null, error: { message: "logout failed" } })),
    });

    await changePassword({ admin: admin as unknown as AdminDep }, BASE_INPUT);

    for (const args of errorSpy.mock.calls) {
      const str = args.map((a: unknown) => String(a)).join(" ");
      expect(str).not.toContain(BASE_INPUT.accessToken);
    }
  });
});
