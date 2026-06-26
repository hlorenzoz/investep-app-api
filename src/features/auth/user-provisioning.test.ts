import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { AppError } from "../../lib/errors";
import type { SendEmailParams, SendEmailResult } from "../../lib/resend";
import { provisionUser } from "./user-provisioning";

// ---------------------------------------------------------------------------
// Tipos auxiliares para los mocks
// ---------------------------------------------------------------------------

interface MockUser {
  id: string;
  email: string;
}

interface SupabaseResult<T> {
  data: T;
  error: null | { code?: string; message: string };
}

interface AdminApi {
  createUser: (opts: unknown) => Promise<SupabaseResult<{ user: MockUser | null }>>;
  listUsers: (
    opts?: unknown,
  ) => Promise<SupabaseResult<{ users: MockUser[]; nextPage?: number | null }>>;
  updateUserById: (id: string, opts: unknown) => Promise<SupabaseResult<{ user: MockUser }>>;
}

interface MockAdmin {
  auth: { admin: AdminApi };
}

// ---------------------------------------------------------------------------
// Factory de admin mock (§10 del diseño)
// ---------------------------------------------------------------------------

function makeAdmin(overrides: Partial<AdminApi> = {}): MockAdmin {
  return {
    auth: {
      admin: {
        createUser: mock(
          async () =>
            ({
              data: { user: { id: "uid-1", email: "test@example.com" } },
              error: null,
            }) as SupabaseResult<{ user: MockUser }>,
        ),
        listUsers: mock(
          async () =>
            ({ data: { users: [], nextPage: null }, error: null }) as SupabaseResult<{
              users: MockUser[];
              nextPage: number | null;
            }>,
        ),
        updateUserById: mock(
          async () =>
            ({
              data: { user: { id: "uid-1", email: "test@example.com" } },
              error: null,
            }) as SupabaseResult<{ user: MockUser }>,
        ),
        ...overrides,
      },
    },
  };
}

// sendEmail mock base
function makeSendEmail(emailId = "email-id-1"): (p: SendEmailParams) => Promise<SendEmailResult> {
  return mock(async () => ({ id: emailId }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provisionUser", () => {
  // 5.10: espías en console para detectar password en logs
  let consoleSpy: {
    log: ReturnType<typeof spyOn>;
    error: ReturnType<typeof spyOn>;
    warn: ReturnType<typeof spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: spyOn(console, "log").mockImplementation(() => {}),
      error: spyOn(console, "error").mockImplementation(() => {}),
      warn: spyOn(console, "warn").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 5.2: usuario nuevo — createUser exitoso
  // ---------------------------------------------------------------------------
  it("5.2: usuario nuevo — devuelve { created: true, userId, emailId } y llama sendEmail una vez", async () => {
    const admin = makeAdmin();
    const sendEmail = makeSendEmail("email-abc");

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "nuevo@example.com" },
    );

    expect(result.created).toBe(true);
    expect(result.userId).toBe("uid-1");
    expect(result.emailId).toBe("email-abc");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 5.3: password del caller se respeta — generatePassword NO se invoca
  // ---------------------------------------------------------------------------
  it("5.3: password explícita del caller se pasa a createUser sin generar una nueva", async () => {
    const callerPassword = "Caller$upplied#2";
    let capturedCreateUserArgs: unknown;

    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedCreateUserArgs = opts;
        return {
          data: { user: { id: "uid-2", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "test@example.com", password: callerPassword },
    );

    expect(result.created).toBe(true);
    expect((capturedCreateUserArgs as { password: string }).password).toBe(callerPassword);
  });

  // ---------------------------------------------------------------------------
  // 5.4: se genera password cuando input.password está ausente
  // ---------------------------------------------------------------------------
  it("5.4: genera password de ≥24 chars del charset sin ambigüos cuando no se pasa password", async () => {
    const AMBIGUOUS = /[O0Il1]/;
    let capturedPassword = "";

    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedPassword = (opts as { password: string }).password;
        return {
          data: { user: { id: "uid-3", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "test@example.com" },
    );

    expect(capturedPassword.length).toBeGreaterThanOrEqual(24);
    expect(AMBIGUOUS.test(capturedPassword)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 5.5: usuario existente — reset idempotente
  // ---------------------------------------------------------------------------
  it("5.5: usuario existente — createUser 'already registered' → listUsers → updateUserById → { created: false }", async () => {
    const existingUser: MockUser = { id: "uid-existing", email: "existing@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(async (_id: string, opts: unknown) => {
        const typedOpts = opts as { user_metadata: { must_reset_password: boolean } };
        return {
          data: { user: existingUser },
          error: null,
          _opts: typedOpts,
        } as unknown as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail("email-reset-1");

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "existing@example.com" },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("uid-existing");
    expect(result.emailId).toBe("email-reset-1");
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 5.6: usuario existente pero no encontrado en paginación → AppError
  // ---------------------------------------------------------------------------
  it("5.6: usuario no encontrado en paginación completa → lanza AppError", async () => {
    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
    });
    const sendEmail = makeSendEmail();

    await expect(
      provisionUser(
        { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
        { email: "ghost@example.com" },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  // ---------------------------------------------------------------------------
  // 5.7: falla de email → AppError sin password en el mensaje
  // ---------------------------------------------------------------------------
  it("5.7: falla de sendEmail → lanza AppError cuyo mensaje no contiene la contraseña", async () => {
    // Captura el password REAL generado (igual que test 5.10) para una aserción literal
    let capturedPassword = "";
    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedPassword = (opts as { password: string }).password;
        return {
          data: { user: { id: "uid-1", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const failSendEmail = mock(async (): Promise<SendEmailResult> => {
      throw new AppError("INTERNAL_ERROR", "Error de correo simulado", 502);
    });

    const err = await provisionUser(
      {
        admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"],
        sendEmail: failSendEmail,
      },
      { email: "test@example.com" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(capturedPassword.length).toBeGreaterThan(0);

    // Aserción literal: el mensaje y cause del AppError NO deben contener la contraseña capturada
    const errorMessage = (err as AppError).message;
    expect(errorMessage).not.toContain(capturedPassword);
    const causeStr = String((err as AppError).cause ?? "");
    expect(causeStr).not.toContain(capturedPassword);
  });

  // ---------------------------------------------------------------------------
  // 5.8: email_confirm: true se pasa a createUser
  // ---------------------------------------------------------------------------
  it("5.8: createUser recibe email_confirm: true", async () => {
    let capturedArgs: unknown;
    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedArgs = opts;
        return {
          data: { user: { id: "uid-1", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "test@example.com" },
    );

    expect((capturedArgs as { email_confirm: boolean }).email_confirm).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5.9: app_metadata.must_reset_password: true en ambos paths (control de seguridad
  //       server-side; user_metadata sería apagable por el propio usuario)
  // ---------------------------------------------------------------------------
  it("5.9a: createUser recibe app_metadata.must_reset_password: true (path creación)", async () => {
    let capturedArgs: unknown;
    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedArgs = opts;
        return {
          data: { user: { id: "uid-1", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "test@example.com" },
    );

    expect(
      (capturedArgs as { app_metadata: { must_reset_password: boolean } }).app_metadata
        .must_reset_password,
    ).toBe(true);
  });

  it("5.9b: updateUserById recibe app_metadata.must_reset_password: true (path reset)", async () => {
    let capturedUpdateArgs: unknown;
    const existingUser: MockUser = { id: "uid-existing", email: "existing@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(async (_id: string, opts: unknown) => {
        capturedUpdateArgs = opts;
        return { data: { user: existingUser }, error: null } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "existing@example.com" },
    );

    expect(
      (capturedUpdateArgs as { app_metadata: { must_reset_password: boolean } }).app_metadata
        .must_reset_password,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5.10: la contraseña generada nunca aparece en los logs
  // ---------------------------------------------------------------------------
  it("5.10: la contraseña generada nunca aparece en console.log/error/warn", async () => {
    let capturedPassword = "";
    const admin = makeAdmin({
      createUser: mock(async (opts: unknown) => {
        capturedPassword = (opts as { password: string }).password;
        return {
          data: { user: { id: "uid-1", email: "test@example.com" } },
          error: null,
        } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "test@example.com" },
    );

    expect(capturedPassword.length).toBeGreaterThan(0);

    // Ningún espía debe haber recibido una llamada que contenga la contraseña
    const allCalls = [
      ...consoleSpy.log.mock.calls,
      ...consoleSpy.error.mock.calls,
      ...consoleSpy.warn.mock.calls,
    ];

    for (const args of allCalls) {
      const str = args.map((a: unknown) => String(a)).join(" ");
      expect(str).not.toContain(capturedPassword);
    }
  });

  // ---------------------------------------------------------------------------
  // Cobertura de branches adicionales (TRIANGULATE)
  // ---------------------------------------------------------------------------

  it("cubre: createUser retorna data.user null sin error → AppError", async () => {
    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: null,
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
    });
    const sendEmail = makeSendEmail();

    await expect(
      provisionUser(
        { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
        { email: "test@example.com" },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("cubre: updateUserById devuelve error → AppError", async () => {
    const existingUser: MockUser = { id: "uid-existing", email: "existing@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "Update failed" },
          }) as unknown as SupabaseResult<{ user: MockUser }>,
      ),
    });
    const sendEmail = makeSendEmail();

    await expect(
      provisionUser(
        { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
        { email: "existing@example.com" },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("cubre: createUser error desconocido (no 'already registered') → AppError", async () => {
    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "Database connection refused" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
    });
    const sendEmail = makeSendEmail();

    await expect(
      provisionUser(
        { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
        { email: "test@example.com" },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("cubre: listUsers devuelve error → AppError propagado desde findUserByEmail", async () => {
    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [] },
            error: { message: "Auth admin error" },
          }) as SupabaseResult<{ users: MockUser[] }>,
      ),
    });
    const sendEmail = makeSendEmail();

    await expect(
      provisionUser(
        { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
        { email: "test@example.com" },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  // ---------------------------------------------------------------------------
  // #2 — detección por código estructurado email_exists
  // ---------------------------------------------------------------------------
  it("#2a: createUser devuelve error.code='email_exists' → path de reset (created: false), no INTERNAL_ERROR", async () => {
    const existingUser: MockUser = { id: "uid-existing", email: "existing@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: {
              code: "email_exists",
              message: "A user with this email address has already been registered",
            },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(
        async () =>
          ({
            data: { user: existingUser },
            error: null,
          }) as SupabaseResult<{ user: MockUser }>,
      ),
    });
    const sendEmail = makeSendEmail("email-reset-2");

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "existing@example.com" },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("uid-existing");
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
  });

  it("#2b: createUser devuelve error.code='user_already_exists' → path de reset (created: false)", async () => {
    const existingUser: MockUser = { id: "uid-existing2", email: "existing2@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { code: "user_already_exists", message: "User already exists" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(
        async () =>
          ({
            data: { user: existingUser },
            error: null,
          }) as SupabaseResult<{ user: MockUser }>,
      ),
    });
    const sendEmail = makeSendEmail("email-reset-3");

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "existing2@example.com" },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("uid-existing2");
  });

  // ---------------------------------------------------------------------------
  // #3 — normalización de email (case-insensitive idempotencia)
  // ---------------------------------------------------------------------------
  it("#3: provisionUser con 'Juan@X.com' encuentra al usuario guardado como 'juan@x.com' (path reset)", async () => {
    // El usuario existe en lowercase en GoTrue
    const existingUser: MockUser = { id: "uid-juan", email: "juan@x.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(
        async () =>
          ({
            data: { user: existingUser },
            error: null,
          }) as SupabaseResult<{ user: MockUser }>,
      ),
    });
    const sendEmail = makeSendEmail("email-juan");

    // Provisionar con email mixto de mayúsculas/minúsculas
    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "Juan@X.com" },
    );

    // Debe encontrar al usuario y hacer reset (no NOT_FOUND)
    expect(result.created).toBe(false);
    expect(result.userId).toBe("uid-juan");
    // El email normalizado se devuelve en el resultado
    expect(result.email).toBe("juan@x.com");
  });

  // ---------------------------------------------------------------------------
  // Fix A — email_confirm: true en el path de reset (updateUserById)
  // ---------------------------------------------------------------------------
  it("A.1: updateUserById recibe email_confirm: true en el path de reset (usuario ya existe)", async () => {
    let capturedUpdateArgs: unknown;
    const existingUser: MockUser = { id: "uid-existing", email: "existing@example.com" };

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(
        async () =>
          ({
            data: { users: [existingUser], nextPage: null },
            error: null,
          }) as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>,
      ),
      updateUserById: mock(async (_id: string, opts: unknown) => {
        capturedUpdateArgs = opts;
        return { data: { user: existingUser }, error: null } as SupabaseResult<{ user: MockUser }>;
      }),
    });
    const sendEmail = makeSendEmail();

    await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "existing@example.com" },
    );

    expect((capturedUpdateArgs as { email_confirm: boolean }).email_confirm).toBe(true);
  });

  it("cubre: paginación — usuario encontrado en la segunda página", async () => {
    const existingUser: MockUser = { id: "uid-page2", email: "page2@example.com" };
    let callCount = 0;

    const admin = makeAdmin({
      createUser: mock(
        async () =>
          ({
            data: { user: null },
            error: { message: "User already registered" },
          }) as SupabaseResult<{ user: MockUser | null }>,
      ),
      listUsers: mock(async () => {
        callCount++;
        if (callCount === 1) {
          // Primera página: 50 usuarios distintos + nextPage = 2
          const firstPageUsers: MockUser[] = Array.from({ length: 50 }, (_, i) => ({
            id: `uid-${i}`,
            email: `user${i}@example.com`,
          }));
          return {
            data: { users: firstPageUsers, nextPage: 2 },
            error: null,
          } as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>;
        }
        // Segunda página: contiene el usuario buscado
        return {
          data: { users: [existingUser], nextPage: null },
          error: null,
        } as SupabaseResult<{ users: MockUser[]; nextPage: number | null }>;
      }),
      updateUserById: mock(
        async () =>
          ({
            data: { user: existingUser },
            error: null,
          }) as SupabaseResult<{ user: MockUser }>,
      ),
    });
    const sendEmail = makeSendEmail("email-page2");

    const result = await provisionUser(
      { admin: admin as unknown as Parameters<typeof provisionUser>[0]["admin"], sendEmail },
      { email: "page2@example.com" },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("uid-page2");
    expect(callCount).toBe(2);
  });
});
