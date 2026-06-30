import { afterEach, describe, expect, it, mock } from "bun:test";
import { createApp } from "../../app";
import type { Env } from "../../types/env";

const ENV: Env = {
  ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "Investep <no-reply@investep.app>",
  CACHE: {} as KVNamespace,
  DOCUMENTS: {} as R2Bucket,
};

const AUTH_ADMIN = { Authorization: "Bearer admin-token" };
const AUTH_MANAGER = { Authorization: "Bearer manager-token" };
const AUTH_USER = { Authorization: "Bearer user-token" };

// UUIDs reales para pasar validación Zod
const UUID_ADMIN = "d3b07384-d113-4c3e-a34f-01123456789a";
const UUID_MANAGER = "d3b07384-d113-4c3e-a34f-01123456789b";
const UUID_USER1 = "d3b07384-d113-4c3e-a34f-01123456789c";
const UUID_NEW_USER = "d3b07384-d113-4c3e-a34f-01123456789d";
const UUID_NONEXISTENT = "00000000-0000-0000-0000-000000000000";

// Datos simulados
const mockProfiles = [
  { id: UUID_ADMIN, full_name: "Administrador General" },
  { id: UUID_MANAGER, full_name: "Gerente Operativo" },
  { id: UUID_USER1, full_name: "Usuario Común" },
];

const mockAuthUsers = [
  {
    id: UUID_ADMIN,
    email: "admin@example.com",
    created_at: "2026-06-01T00:00:00.000Z",
    app_metadata: { role: "admin", is_admin: true },
  },
  {
    id: UUID_MANAGER,
    email: "manager@example.com",
    created_at: "2026-06-02T00:00:00.000Z",
    app_metadata: { role: "manager", is_manager: true },
  },
  {
    id: UUID_USER1,
    email: "user1@example.com",
    created_at: "2026-06-03T00:00:00.000Z",
    app_metadata: { role: "user" },
  },
];

// Helper para mockear fetch
function setupFetchMocks(
  opts: {
    authError?: boolean;
    dbError?: boolean;
    resendError?: boolean;
    authEmptyList?: boolean;
    userNotFound?: boolean;
  } = {},
) {
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method?.toUpperCase() ?? "GET";

    // 1. Mock de verificación de sesión (Bearer Auth)
    if (url.includes("/auth/v1/user")) {
      const headers = init?.headers as Record<string, string> | undefined;
      const authHeader = headers?.Authorization || "";
      if (authHeader.includes("admin-token")) {
        return new Response(JSON.stringify(mockAuthUsers[0]), { status: 200 });
      }
      if (authHeader.includes("manager-token")) {
        return new Response(JSON.stringify(mockAuthUsers[1]), { status: 200 });
      }
      if (authHeader.includes("user-token")) {
        return new Response(JSON.stringify(mockAuthUsers[2]), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    // 2. Mock de Resend (emails)
    if (url.includes("api.resend.com/emails")) {
      if (opts.resendError) {
        return new Response("Resend Error", { status: 500 });
      }
      return new Response(JSON.stringify({ id: "email-resend-id-123" }), { status: 200 });
    }

    // 3. Mock de Supabase Auth Admin APIs
    if (url.includes("/auth/v1/admin/users")) {
      if (opts.authError) {
        return new Response(JSON.stringify({ error: "Internal Auth Error" }), { status: 500 });
      }

      // Detalle de un usuario específico /auth/v1/admin/users/{id}
      const matchId = url.match(/\/auth\/v1\/admin\/users\/([a-zA-Z0-9-]+)$/);
      if (matchId) {
        const id = matchId[1];
        if (opts.userNotFound || id === UUID_NONEXISTENT) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const user = mockAuthUsers.find((u) => u.id === id) || {
          id: UUID_NEW_USER,
          email: "newlycreated@example.com",
          created_at: new Date().toISOString(),
          app_metadata: { role: "manager", is_manager: true },
        };

        if (method === "DELETE") {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (method === "PUT" || method === "PATCH") {
          const body = JSON.parse((init?.body as string) ?? "{}");
          const updated = {
            ...user,
            email: body.email ?? user.email,
            app_metadata: {
              ...user.app_metadata,
              ...(body.app_metadata ?? {}),
            },
          };
          return new Response(JSON.stringify(updated), { status: 200 });
        }
        return new Response(JSON.stringify(user), { status: 200 });
      }

      // Listado de usuarios /auth/v1/admin/users
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            users: opts.authEmptyList ? [] : mockAuthUsers,
          }),
          { status: 200 },
        );
      }

      // Creación de usuario /auth/v1/admin/users
      if (method === "POST") {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const newUser = {
          id: UUID_NEW_USER,
          email: body.email,
          created_at: new Date().toISOString(),
          app_metadata: body.app_metadata ?? {},
        };
        return new Response(JSON.stringify(newUser), { status: 200 });
      }
    }

    // 4. Mock de PostgREST DB (profiles)
    if (url.includes("/rest/v1/profiles")) {
      if (opts.dbError) {
        return new Response(JSON.stringify({ message: "DB Error" }), { status: 400 });
      }

      if (method === "GET") {
        if (url.includes("eq.")) {
          const matchId = url.match(/id=eq\.([a-zA-Z0-9-]+)/);
          const id = matchId ? matchId[1] : null;
          const profile = mockProfiles.find((p) => p.id === id) || {
            id: UUID_NEW_USER,
            full_name: "Nuevo Aprovisionado",
          };
          return new Response(JSON.stringify([profile]), { status: 200 });
        }
        return new Response(JSON.stringify(mockProfiles), { status: 200 });
      }

      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return new Response(JSON.stringify(body), { status: 201 });
      }
    }

    return new Response("Not Mocked", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("CRUD de Usuarios y Roles (Admin)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Autorización ---

  it("401 sin token de autenticación", async () => {
    setupFetchMocks();
    const res = await createApp().request("/admin/users", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("403 si el usuario es de rol normal", async () => {
    setupFetchMocks();
    const res = await createApp().request("/admin/users", { headers: AUTH_USER }, ENV);
    expect(res.status).toBe(403);
  });

  it("403 si el usuario es manager (solo admin puede hacer CRUD de usuarios)", async () => {
    setupFetchMocks();
    const res = await createApp().request("/admin/users", { headers: AUTH_MANAGER }, ENV);
    expect(res.status).toBe(403);
  });

  // --- GET /admin/users (Listar) ---

  it("200 lista todos los usuarios combinados con perfiles", async () => {
    setupFetchMocks();
    const res = await createApp().request("/admin/users", { headers: AUTH_ADMIN }, ENV);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: {
        id: string;
        email: string;
        role: "admin" | "manager" | "user";
        fullName: string | null;
        createdAt: string;
        mustResetPassword: boolean;
      }[];
    };
    expect(body.users.length).toBe(3);

    const adminUser = body.users.find((u) => u.id === UUID_ADMIN);
    expect(adminUser).toBeDefined();
    expect(adminUser?.role).toBe("admin");
    expect(adminUser?.fullName).toBe("Administrador General");

    const managerUser = body.users.find((u) => u.id === UUID_MANAGER);
    expect(managerUser).toBeDefined();
    expect(managerUser?.role).toBe("manager");
    expect(managerUser?.fullName).toBe("Gerente Operativo");
  });

  it("502 si falla la API de Auth al listar", async () => {
    setupFetchMocks({ authError: true });
    const res = await createApp().request("/admin/users", { headers: AUTH_ADMIN }, ENV);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("502 si falla la DB de perfiles al listar", async () => {
    setupFetchMocks({ dbError: true });
    const res = await createApp().request("/admin/users", { headers: AUTH_ADMIN }, ENV);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  // --- GET /admin/users/:id (Detalle) ---

  it("200 detalle de un usuario existente", async () => {
    setupFetchMocks();
    const res = await createApp().request(
      `/admin/users/${UUID_MANAGER}`,
      { headers: AUTH_ADMIN },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: {
        id: string;
        email: string;
        role: "admin" | "manager" | "user";
        fullName: string | null;
        createdAt: string;
        mustResetPassword: boolean;
      };
    };
    expect(body.user.id).toBe(UUID_MANAGER);
    expect(body.user.email).toBe("manager@example.com");
    expect(body.user.role).toBe("manager");
    expect(body.user.fullName).toBe("Gerente Operativo");
  });

  it("404 si el usuario no existe", async () => {
    setupFetchMocks({ userNotFound: true });
    const res = await createApp().request(
      `/admin/users/${UUID_NONEXISTENT}`,
      { headers: AUTH_ADMIN },
      ENV,
    );

    expect(res.status).toBe(404);
  });

  // --- POST /admin/users (Crear / Aprovisionar) ---

  it("201 aprovisiona un nuevo usuario", async () => {
    setupFetchMocks();
    const payload = {
      email: "newlycreated@example.com",
      fullName: "Nuevo Aprovisionado",
      role: "manager",
    };

    const res = await createApp().request(
      "/admin/users",
      {
        method: "POST",
        headers: { ...AUTH_ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      ENV,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: {
        id: string;
        email: string;
        role: "admin" | "manager" | "user";
        fullName: string | null;
        createdAt: string;
        mustResetPassword: boolean;
      };
    };
    expect(body.user.id).toBe(UUID_NEW_USER);
  });

  it("422 si el payload es inválido para creación (Zod error)", async () => {
    setupFetchMocks();
    const payload = {
      email: "invalid-email",
      role: "invalid-role",
    };

    const res = await createApp().request(
      "/admin/users",
      {
        method: "POST",
        headers: { ...AUTH_ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      ENV,
    );

    expect(res.status).toBe(422);
  });

  // --- PATCH /admin/users/:id (Actualizar) ---

  it("200 actualiza datos y rol del usuario", async () => {
    setupFetchMocks();
    const payload = {
      fullName: "Gerente Renombrado",
      role: "admin",
    };

    const res = await createApp().request(
      `/admin/users/${UUID_MANAGER}`,
      {
        method: "PATCH",
        headers: { ...AUTH_ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: {
        id: string;
        email: string;
        role: "admin" | "manager" | "user";
        fullName: string | null;
        createdAt: string;
        mustResetPassword: boolean;
      };
    };
    expect(body.user.id).toBe(UUID_MANAGER);
  });

  // --- DELETE /admin/users/:id (Eliminar) ---

  it("200 elimina el usuario exitosamente", async () => {
    setupFetchMocks();
    const res = await createApp().request(
      `/admin/users/${UUID_USER1}`,
      {
        method: "DELETE",
        headers: AUTH_ADMIN,
      },
      ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("404 al intentar eliminar un usuario que no existe", async () => {
    setupFetchMocks({ userNotFound: true });
    const res = await createApp().request(
      `/admin/users/${UUID_NONEXISTENT}`,
      {
        method: "DELETE",
        headers: AUTH_ADMIN,
      },
      ENV,
    );

    expect(res.status).toBe(404);
  });
});
