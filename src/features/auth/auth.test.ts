import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createApp } from "../../app";
import type { Env } from "../../types/env";

const ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

/**
 * Simula la respuesta del endpoint GoTrue `GET /auth/v1/user` que consume
 * internamente `supabase.auth.getUser(token)`. El cuerpo ES el usuario.
 */
function mockGoTrueUser(user: Record<string, unknown>) {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("GET /auth/me", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin header Authorization", async () => {
    const res = await createApp().request("/auth/me", {}, ENV);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 cuando Supabase rechaza el token", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer invalid" } },
      ENV,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("200 con el usuario cuando el token es válido", async () => {
    mockGoTrueUser({
      id: "uid-123",
      email: "user@example.com",
      user_metadata: { must_reset_password: false },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; mustResetPassword: boolean; role: string };
    };
    expect(body.user.id).toBe("uid-123");
    expect(body.user.email).toBe("user@example.com");
    expect(body.user.mustResetPassword).toBe(false);
    expect(body.user.role).toBe("user"); // Rol por defecto
  });

  it("resuelve role: admin cuando app_metadata tiene is_admin: true", async () => {
    mockGoTrueUser({
      id: "uid-123-admin",
      email: "admin@example.com",
      app_metadata: { is_admin: true },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe("admin");
  });

  it("resuelve role: manager cuando app_metadata tiene role: manager", async () => {
    mockGoTrueUser({
      id: "uid-123-manager",
      email: "manager@example.com",
      app_metadata: { role: "manager" },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe("manager");
  });

  it("expone mustResetPassword: true cuando app_metadata lo indica", async () => {
    mockGoTrueUser({
      id: "uid-456",
      email: "reset@example.com",
      app_metadata: { must_reset_password: true },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { mustResetPassword: boolean } };
    expect(body.user.mustResetPassword).toBe(true);
  });

  // Headline de seguridad: el flag es un CONTROL DE SEGURIDAD y vive en app_metadata
  // (solo escribible server-side). Un usuario NO puede apagarlo escribiendo user_metadata
  // vía `supabase.auth.updateUser({ data: { must_reset_password: false } })`.
  it("BYPASS BLOQUEADO: user_metadata.must_reset_password=false NO apaga el flag si app_metadata=true", async () => {
    mockGoTrueUser({
      id: "uid-bypass",
      email: "bypass@example.com",
      app_metadata: { must_reset_password: true },
      user_metadata: { must_reset_password: false },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { mustResetPassword: boolean } };
    // app_metadata manda: el flag sigue en true pese al user_metadata=false.
    expect(body.user.mustResetPassword).toBe(true);
  });

  it("user_metadata.must_reset_password=true se IGNORA (solo app_metadata cuenta)", async () => {
    mockGoTrueUser({
      id: "uid-ignore",
      email: "ignore@example.com",
      app_metadata: { must_reset_password: false },
      user_metadata: { must_reset_password: true },
    });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { mustResetPassword: boolean } };
    expect(body.user.mustResetPassword).toBe(false);
  });

  it("401 cuando el usuario no tiene email", async () => {
    mockGoTrueUser({ id: "uid-789", user_metadata: {} });

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it("503 (no 401) cuando no se puede verificar contra Supabase (red caída / outage)", async () => {
    // fetch que falla → supabase-js lo envuelve en AuthRetryableFetchError.
    // Un token VÁLIDO no debe convertirse en 401 (deslogueo espurio) ante un fallo de infra.
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    // supabase-js loguea el fallo de fetch con console.error; lo silenciamos para no
    // ensuciar la salida del test (no es un error del test, es ruido del SDK).
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );
    errorSpy.mockRestore();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  // Resiliencia: GoTrue con throttling (429) o caído (5xx) NO es un token inválido. Debe dar
  // 503 reintentable, no 401 (deslogueo espurio). Blinda las condiciones `!== 429` y `< 500`.
  for (const status of [429, 500, 503]) {
    it(`503 (no 401) cuando GoTrue responde ${status} (throttling/outage, token no rechazado)`, async () => {
      globalThis.fetch = mock(
        async () =>
          new Response(JSON.stringify({ message: "boom", code: "over_request_rate_limit" }), {
            status,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch;
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const res = await createApp().request(
        "/auth/me",
        { headers: { Authorization: "Bearer valid" } },
        ENV,
      );
      errorSpy.mockRestore();

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      // §5: el crudo de GoTrue no se filtra.
      expect(body.error.message).not.toContain("boom");
    });
  }
});

/**
 * Mock que rutea por URL para poder resolver el plan del usuario:
 * - `GET /auth/v1/user`             → requireAuth (getUser).
 * - `GET /rest/v1/academy_memberships` → getPlanSlug (PostgREST).
 * Si `plan` es null, la query devuelve `{}` (0 filas embebidas) → planSlug null.
 */
function mockMeWithPlan(user: Record<string, unknown>, plan: { slug: string } | null) {
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/rest/v1/academy_memberships")) {
      const body = plan ? { investep_plans: { slug: plan.slug } } : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("GET /auth/me — planSlug", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("expone planSlug con el slug del plan activo del usuario", async () => {
    mockMeWithPlan(
      { id: "uid-plan", email: "gold@example.com", user_metadata: {} },
      { slug: "gold" },
    );

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { planSlug: string | null } };
    expect(body.user.planSlug).toBe("gold");
  });

  it("planSlug es null cuando el usuario no tiene membresía activa", async () => {
    mockMeWithPlan({ id: "uid-free", email: "free@example.com", user_metadata: {} }, null);

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { planSlug: string | null } };
    expect(body.user.planSlug).toBeNull();
  });

  it("loguea y degrada a planSlug null cuando la query de plan falla", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = mock(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rest/v1/academy_memberships")) {
        return new Response(
          JSON.stringify({ code: "42P01", message: "boom", details: null, hint: null }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ id: "uid-err", email: "err@example.com", user_metadata: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const res = await createApp().request(
      "/auth/me",
      { headers: { Authorization: "Bearer valid" } },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { planSlug: string | null } };
    expect(body.user.planSlug).toBeNull();
    // §12: el fallo del lookup deja rastro; nunca se traga en silencio.
    const logged = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes("plan_slug_lookup_failed"),
    );
    expect(logged).toBe(true);
    errorSpy.mockRestore();
  });
});

/**
 * Mock de fetch para el flujo completo de change-password. Rutea por URL:
 * - `GET /auth/v1/user`          → requireAuth (anon client `getUser`).
 * - `PUT /auth/v1/admin/users/*` → admin `updateUserById`.
 * - `POST /auth/v1/logout`       → admin `signOut` (revocación global).
 */
// supabase-js valida que el id sea un UUID en updateUserById (lanza si no lo es),
// así que el usuario autenticado debe tener un id con formato UUID válido.
const CP_UUID = "8f3b1d2e-0a4c-4e6f-9b2a-1c2d3e4f5a6b";

/** Registra a quién se le pegó: para asserts de authz (userId del PUT) y de revocación (logout). */
interface ChangePasswordCalls {
  /** UUIDs extraídos del path de `PUT /auth/v1/admin/users/:id` (a qué usuario se le cambió la clave). */
  adminUserIds: string[];
  /** Cantidad de `POST /auth/v1/logout` (revocación de sesiones). */
  logoutCount: number;
  /** Cantidad de `GET /rest/v1/academy_memberships` (lookup de plan; no debe ocurrir acá). */
  academyQueryCount: number;
}

function mockChangePassword(cfg: { updateErrorStatus?: number } = {}): ChangePasswordCalls {
  const calls: ChangePasswordCalls = { adminUserIds: [], logoutCount: 0, academyQueryCount: 0 };
  globalThis.fetch = mock(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/rest/v1/academy_memberships")) {
      calls.academyQueryCount++;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/auth/v1/admin/users/")) {
      const match = url.match(/\/auth\/v1\/admin\/users\/([^/?]+)/);
      if (match?.[1]) calls.adminUserIds.push(match[1]);
      if (cfg.updateErrorStatus) {
        return new Response(JSON.stringify({ message: "boom" }), {
          status: cfg.updateErrorStatus,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: CP_UUID,
          email: "u@example.com",
          app_metadata: {},
          user_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/auth/v1/logout")) {
      calls.logoutCount++;
      return new Response(null, { status: 204 });
    }
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          id: CP_UUID,
          email: "u@example.com",
          app_metadata: { must_reset_password: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

const JSON_AUTH = {
  method: "POST",
  headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
};

describe("POST /auth/change-password", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 sin token (no llega siquiera a validar el body)", async () => {
    const res = await createApp().request(
      "/auth/change-password",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      ENV,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("200 happy: cambia la contraseña, revoca sesiones y devuelve mustResetPassword=false", async () => {
    const calls = mockChangePassword();
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "nueva-clave-segura" }) },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; mustResetPassword: boolean };
    };
    expect(body.user.id).toBe(CP_UUID);
    expect(body.user.email).toBe("u@example.com");
    expect(body.user.mustResetPassword).toBe(false);
    // Se le cambió la clave al usuario del token y se revocaron sus sesiones (1 logout).
    expect(calls.adminUserIds).toEqual([CP_UUID]);
    expect(calls.logoutCount).toBe(1);
  });

  // El endpoint revoca TODAS las sesiones → el cliente DEBE re-loguear, y `/auth/me` ya
  // resuelve el plan fresco. Enriquecer la respuesta con planSlug acá es trabajo tirado:
  // no debe haber round-trip a academy_memberships.
  it("no consulta el plan del usuario (academy_memberships) — evita un round-trip inútil", async () => {
    const calls = mockChangePassword();
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "nueva-clave-segura" }) },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(calls.academyQueryCount).toBe(0);
  });

  // CRITICAL (authz, §11): el userId DEBE salir del token, jamás del body. Si el cliente
  // inyecta un userId/id ajeno, el cambio NO debe redirigirse a ese usuario.
  it("AUTHZ: ignora un userId inyectado en el body — el cambio aplica al usuario del token", async () => {
    const calls = mockChangePassword();
    const OTHER = "11111111-2222-3333-4444-555555555555";
    const res = await createApp().request(
      "/auth/change-password",
      {
        ...JSON_AUTH,
        body: JSON.stringify({ newPassword: "nueva-clave-segura", userId: OTHER, id: OTHER }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    // El PUT admin apunta al usuario del TOKEN (CP_UUID), nunca al inyectado.
    expect(calls.adminUserIds).toEqual([CP_UUID]);
    expect(calls.adminUserIds).not.toContain(OTHER);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(CP_UUID);
  });

  it("400 cuando la contraseña es demasiado corta (política)", async () => {
    mockChangePassword();
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "corta" }) },
      ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 cuando falta newPassword (body inválido)", async () => {
    mockChangePassword();
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({}) },
      ENV,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("503 cuando Supabase está caído al actualizar; NO revoca sesiones ni filtra el crudo", async () => {
    const calls = mockChangePassword({ updateErrorStatus: 500 });
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "nueva-clave-segura" }) },
      ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    // La clave NO cambió → no se revocan sesiones (no desloguear al usuario sin motivo).
    expect(calls.logoutCount).toBe(0);
    // §5: el mensaje crudo de GoTrue ("boom") nunca se filtra al cliente.
    expect(body.error.message).not.toContain("boom");
  });

  it("400 cuando GoTrue rechaza la contraseña (422: débil / igual a la anterior)", async () => {
    mockChangePassword({ updateErrorStatus: 422 });
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "nueva-clave-segura" }) },
      ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    // §5: el mensaje crudo de GoTrue no se filtra; se devuelve el mensaje fijo de política.
    expect(body.error.message).not.toContain("boom");
  });

  it("500 ante un error genuino no-input ni transitorio (404 de GoTrue)", async () => {
    mockChangePassword({ updateErrorStatus: 404 });
    const res = await createApp().request(
      "/auth/change-password",
      { ...JSON_AUTH, body: JSON.stringify({ newPassword: "nueva-clave-segura" }) },
      ENV,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
