import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "../../lib/openapi";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
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
 * Protegido por requireAuth + requireAdmin.
 */
export const adminUsersRouter = new OpenAPIHono<AuthedBindings>({
  defaultHook: validationHook<AuthedBindings>(),
});

adminUsersRouter.use("*", requireAuth);
adminUsersRouter.use("*", requireAdmin);

adminUsersRouter
  .openapi(listUsersRoute, listUsersHandler)
  .openapi(getUserRoute, getUserHandler)
  .openapi(createUserRoute, createUserHandler)
  .openapi(updateUserRoute, updateUserHandler)
  .openapi(deleteUserRoute, deleteUserHandler);
