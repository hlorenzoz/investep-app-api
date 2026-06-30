import type { RouteHandler } from "@hono/zod-openapi";
import { sendEmail } from "../../lib/resend";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  createUserRoute,
  deleteUserRoute,
  getUserRoute,
  listUsersRoute,
  updateUserRoute,
} from "./users.routes";
import {
  createUser as createUserService,
  deleteUser as deleteUserService,
  getUser as getUserService,
  listUsers as listUsersService,
  updateUser as updateUserService,
} from "./users.service";

export const listUsersHandler: RouteHandler<typeof listUsersRoute, AuthedBindings> = async (c) => {
  const admin = createSupabaseAdminClient(c.env);
  const users = await listUsersService({ admin });
  return c.json({ users }, 200);
};

export const getUserHandler: RouteHandler<typeof getUserRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  const user = await getUserService({ admin }, id);
  return c.json({ user }, 200);
};

export const createUserHandler: RouteHandler<typeof createUserRoute, AuthedBindings> = async (
  c,
) => {
  const body = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  const user = await createUserService(
    {
      admin,
      sendEmail: (params) => sendEmail(c.env, params),
    },
    body,
  );
  return c.json({ user }, 201);
};

export const updateUserHandler: RouteHandler<typeof updateUserRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  const user = await updateUserService({ admin }, id, body);
  return c.json({ user }, 200);
};

export const deleteUserHandler: RouteHandler<typeof deleteUserRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  const result = await deleteUserService({ admin }, id);
  return c.json(result, 200);
};
