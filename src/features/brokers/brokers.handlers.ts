import type { RouteHandler } from "@hono/zod-openapi";
import { AppError } from "../../lib/errors";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  CreateBrokerRoute,
  DeleteBrokerRoute,
  GetBrokerRoute,
  ListBrokersRoute,
  UpdateBrokerRoute,
} from "./brokers.routes";
import {
  createBroker,
  deleteBroker,
  getBroker,
  listBrokers,
  updateBroker,
} from "./brokers.service";

// El gate de autorización (`requireAdmin`) vive en el router; estos handlers asumen
// que ya pasó. Cada uno arma el admin client (service-role, bypassa RLS) por request
// — sin estado en módulo (Workers, §3).

/** GET /brokers — lista el catálogo de brokers (admin-only). */
export const listBrokersHandler: RouteHandler<ListBrokersRoute, AuthedBindings> = async (c) => {
  const result = await listBrokers(createSupabaseAdminClient(c.env));
  return c.json(result, 200);
};

/** GET /brokers/:idOrSlug — devuelve un broker por id o slug; 404 si no existe (admin-only). */
export const getBrokerHandler: RouteHandler<GetBrokerRoute, AuthedBindings> = async (c) => {
  const { idOrSlug } = c.req.valid("param");
  const broker = await getBroker(createSupabaseAdminClient(c.env), idOrSlug);
  if (!broker) throw new AppError("NOT_FOUND", "Broker no encontrado.", 404);
  return c.json({ broker }, 200);
};

/** POST /brokers — crea un broker (admin-only). Responde 201 con el broker creado. */
export const createBrokerHandler: RouteHandler<CreateBrokerRoute, AuthedBindings> = async (c) => {
  const input = c.req.valid("json");
  const broker = await createBroker(createSupabaseAdminClient(c.env), input);
  return c.json({ broker }, 201);
};

/** PATCH /brokers/:id — actualiza campos de un broker (admin-only). */
export const updateBrokerHandler: RouteHandler<UpdateBrokerRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const broker = await updateBroker(createSupabaseAdminClient(c.env), id, patch);
  return c.json({ broker }, 200);
};

/** DELETE /brokers/:id — elimina un broker (admin-only). */
export const deleteBrokerHandler: RouteHandler<DeleteBrokerRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  await deleteBroker(createSupabaseAdminClient(c.env), id);
  return c.json({ deleted: true as const }, 200);
};
