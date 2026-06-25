import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { Env } from "../../types/env";
import { createSupabaseCapitalRepository } from "./capital.repository";
import type {
  CreateAllocationRoute,
  DeleteAllocationRoute,
  GetCapitalRoute,
  PutCapitalRoute,
  UpdateAllocationRoute,
} from "./capital.routes";
import {
  createAllocation,
  deleteAllocation,
  getCapitalView,
  setCapital,
  updateAllocation,
} from "./capital.service";

const repoFor = (env: Env) => createSupabaseCapitalRepository(createSupabaseAdminClient(env));

export const getCapitalHandler: RouteHandler<GetCapitalRoute, AuthedBindings> = async (c) => {
  const view = await getCapitalView(repoFor(c.env), c.get("user").id);
  return c.json(view, 200);
};

export const putCapitalHandler: RouteHandler<PutCapitalRoute, AuthedBindings> = async (c) => {
  const { totalCapital, currency } = c.req.valid("json");
  const capital = await setCapital(repoFor(c.env), c.get("user").id, {
    totalCapital,
    currency: currency ?? "USD",
  });
  return c.json({ capital }, 200);
};

export const createAllocationHandler: RouteHandler<CreateAllocationRoute, AuthedBindings> = async (
  c,
) => {
  const allocation = await createAllocation(repoFor(c.env), c.get("user").id, c.req.valid("json"));
  return c.json({ allocation }, 201);
};

export const updateAllocationHandler: RouteHandler<UpdateAllocationRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  const allocation = await updateAllocation(
    repoFor(c.env),
    c.get("user").id,
    id,
    c.req.valid("json"),
  );
  return c.json({ allocation }, 200);
};

export const deleteAllocationHandler: RouteHandler<DeleteAllocationRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  await deleteAllocation(repoFor(c.env), c.get("user").id, id);
  return c.json({ deleted: true as const }, 200);
};
