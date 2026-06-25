import type { RouteHandler } from "@hono/zod-openapi";
import { createSupabaseAdminClient } from "../../lib/supabase";
import type { AuthedBindings } from "../../types/app";
import type { ListPlansRoute } from "./plans.routes";
import { listPlans } from "./plans.service";

export const listPlansHandler: RouteHandler<ListPlansRoute, AuthedBindings> = async (c) => {
  const { locale, accountType } = c.req.valid("query");
  const admin = createSupabaseAdminClient(c.env);
  const result = await listPlans(admin, { locale, accountType });
  return c.json(result, 200);
};
