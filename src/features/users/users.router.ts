import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import { createRateLimitMiddleware } from "../../middleware/rate-limit";
import type { AuthedBindings } from "../../types/app";
import {
  createUserHandler,
  deleteUserHandler,
  getUserHandler,
  listUsersHandler,
  updateUserHandler,
} from "./users.handlers";
import {
  createUserRoute,
  deleteUserRoute,
  getUserRoute,
  listUsersRoute,
  updateUserRoute,
} from "./users.routes";

/**
 * Router ADMIN de usuarios: CRUD de administración de usuarios y roles.
 * Protegido por rate limiting (solo mutaciones) + requireAuth + requireAdmin —
 * el router es dueño de TODA su protección, a la misma altura que su auth.
 */
export const adminUsersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

// Solo mutaciones: el POST aprovisiona y ENVÍA EMAIL vía Resend (vector de
// costo/abuso); los GET de listado no se limitan. Corre antes de requireAuth.
adminUsersRouter.use(
  "*",
  createRateLimitMiddleware({
    name: "ADMIN_WRITE_RATE_LIMITER",
    getLimiter: (env) => env.ADMIN_WRITE_RATE_LIMITER,
    methods: ["POST", "PATCH", "PUT", "DELETE"],
  }),
);
adminUsersRouter.use("*", requireAuth);
adminUsersRouter.use("*", requireAdmin);

adminUsersRouter
  .openapi(listUsersRoute, listUsersHandler)
  .openapi(getUserRoute, getUserHandler)
  .openapi(createUserRoute, createUserHandler)
  .openapi(updateUserRoute, updateUserHandler)
  .openapi(deleteUserRoute, deleteUserHandler);
