import type { RouteHandler } from "@hono/zod-openapi";
import { AppError } from "../../lib/errors";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type {
  AddFavoriteRoute,
  AssociatePlanRoute,
  AssociateRelationRoute,
  CreateTickerRoute,
  DeleteTickerRoute,
  DisassociatePlanRoute,
  DisassociateRelationRoute,
  GetTickerRoute,
  ListTickersRoute,
  RelationsOverviewRoute,
  RemoveFavoriteRoute,
  UpdateTickerRoute,
} from "./tickers.routes";
import {
  associatePlan,
  associateRelation,
  createTicker,
  deleteTicker,
  disassociatePlan,
  disassociateRelation,
  getRelationsOverview,
  getTickerDetail,
  listTickers,
  setFavorite,
  unsetFavorite,
  updateTicker,
} from "./tickers.service";

/** GET /tickers — Buscar y listar activos */
export const listTickersHandler: RouteHandler<ListTickersRoute, AuthedBindings> = async (c) => {
  const query = c.req.valid("query");
  const admin = createSupabaseAdminClient(c.env);
  const { tickers, total, page, limit } = await listTickers(admin, c.get("user").id, query);
  return c.json(
    {
      tickers,
      pagination: { page, limit, total },
    },
    200,
  );
};

/** GET /tickers/{symbol} — Obtener el detalle de un activo */
export const getTickerHandler: RouteHandler<GetTickerRoute, AuthedBindings> = async (c) => {
  const { symbol } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  const ticker = await getTickerDetail(admin, c.get("user").id, symbol);

  if (!ticker) {
    throw new AppError("NOT_FOUND", "El activo no existe.", 404);
  }

  return c.json(ticker, 200);
};

/** PUT /tickers/{symbol}/favorite — Marcar como favorito */
export const addFavoriteHandler: RouteHandler<AddFavoriteRoute, AuthedBindings> = async (c) => {
  const { symbol } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  await setFavorite(admin, c.get("user").id, symbol);
  return c.json({ favorite: true as const }, 200);
};

/** DELETE /tickers/{symbol}/favorite — Quitar de favoritos */
export const removeFavoriteHandler: RouteHandler<RemoveFavoriteRoute, AuthedBindings> = async (
  c,
) => {
  const { symbol } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  await unsetFavorite(admin, c.get("user").id, symbol);
  return c.json({ favorite: false as const }, 200);
};

/** GET /tickers/relations-overview — Vista de referencia de relaciones entre activos */
export const relationsOverviewHandler: RouteHandler<
  RelationsOverviewRoute,
  AuthedBindings
> = async (c) => {
  const admin = createSupabaseAdminClient(c.env);
  const overview = await getRelationsOverview(admin, c.get("user").id);
  return c.json(overview, 200);
};

/** POST /admin/tickers — Crear un activo */
export const createTickerHandler: RouteHandler<CreateTickerRoute, AuthedBindings> = async (c) => {
  const body = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  const ticker = await createTicker(admin, body);
  return c.json({ ticker }, 201);
};

/** PATCH /admin/tickers/{id} — Actualizar parcialmente un activo */
export const updateTickerHandler: RouteHandler<UpdateTickerRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  const ticker = await updateTicker(admin, id, body);
  return c.json({ ticker }, 200);
};

/** DELETE /admin/tickers/{id} — Eliminar un activo */
export const deleteTickerHandler: RouteHandler<DeleteTickerRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const admin = createSupabaseAdminClient(c.env);
  await deleteTicker(admin, id);
  return c.json({ deleted: true as const }, 200);
};

/** POST /admin/tickers/{id}/relations — Establecer relación */
export const associateRelationHandler: RouteHandler<
  AssociateRelationRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  const { relatedTickerId, relationType, multiplier } = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  await associateRelation(admin, id, relatedTickerId, relationType, multiplier);
  return c.json({ associated: true as const }, 201);
};

/** DELETE /admin/tickers/{id}/relations — Eliminar relación */
export const disassociateRelationHandler: RouteHandler<
  DisassociateRelationRoute,
  AuthedBindings
> = async (c) => {
  const { id } = c.req.valid("param");
  const { relatedTickerId, relationType } = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  await disassociateRelation(admin, id, relatedTickerId, relationType);
  return c.json({ disassociated: true as const }, 200);
};

/** POST /admin/tickers/{id}/plans — Asociar activo a plan */
export const associatePlanHandler: RouteHandler<AssociatePlanRoute, AuthedBindings> = async (c) => {
  const { id } = c.req.valid("param");
  const { planId } = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  await associatePlan(admin, id, planId);
  return c.json({ associated: true as const }, 201);
};

/** DELETE /admin/tickers/{id}/plans — Desasociar activo de plan */
export const disassociatePlanHandler: RouteHandler<DisassociatePlanRoute, AuthedBindings> = async (
  c,
) => {
  const { id } = c.req.valid("param");
  const { planId } = c.req.valid("json");
  const admin = createSupabaseAdminClient(c.env);
  await disassociatePlan(admin, id, planId);
  return c.json({ disassociated: true as const }, 200);
};
