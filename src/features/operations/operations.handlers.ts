import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { Env } from "../../types/env";
import { createSupabaseOperationsRepository } from "./operations.repository";
import type {
  CreateOperationRoute,
  DeleteOperationRoute,
  GetOperationRoute,
  ListOperationsRoute,
  UpdateOperationRoute,
} from "./operations.routes";
import {
  createOperation,
  deleteOperation,
  getOperation,
  listOperations,
  updateOperation,
} from "./operations.service";

const repoFor = (env: Env) => createSupabaseOperationsRepository(createSupabaseAdminClient(env));

export const listOperationsHandler: RouteHandler<ListOperationsRoute, AuthedBindings> = async (
  c,
) => {
  const { allocationId, status } = c.req.valid("query");
  const operations = await listOperations(repoFor(c.env), c.get("user").id, {
    allocationId,
    status,
  });
  return c.json({ operations }, 200);
};

export const createOperationHandler: RouteHandler<CreateOperationRoute, AuthedBindings> = async (
  c,
) => {
  const operation = await createOperation(repoFor(c.env), c.get("user").id, c.req.valid("json"));
  return c.json({ operation }, 201);
};

export const getOperationHandler: RouteHandler<GetOperationRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const operation = await getOperation(repoFor(c.env), c.get("user").id, id);
  return c.json({ operation }, 200);
};

export const updateOperationHandler: RouteHandler<UpdateOperationRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  const operation = await updateOperation(
    repoFor(c.env),
    c.get("user").id,
    id,
    c.req.valid("json"),
  );
  return c.json({ operation }, 200);
};

export const deleteOperationHandler: RouteHandler<DeleteOperationRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  await deleteOperation(repoFor(c.env), c.get("user").id, id);
  return c.json({ deleted: true as const }, 200);
};
