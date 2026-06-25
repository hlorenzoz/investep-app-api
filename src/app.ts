import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { authRouter } from "./features/auth";
import { brokersRouter } from "./features/brokers";
import { capitalRouter } from "./features/capital";
import { healthRouter } from "./features/health/health.router";
import { plansRouter } from "./features/plans";
import { portfolioRouter } from "./features/portfolio";
import { openApiConfig, validationHook } from "./lib/openapi";
import { docsGuard } from "./middleware/docs-guard";
import { errorHandler } from "./middleware/error-handler";
import type { AppBindings } from "./types/app";

const OPENAPI_JSON_PATH = "/openapi.json";

/**
 * Construye la app. Es una factory (no un singleton de módulo) para que los tests
 * creen instancias aisladas y para no asumir estado entre requests (AGENTS.md §3).
 */
export function createApp() {
  const app = new OpenAPIHono<AppBindings>({
    // Toda falla de validación Zod sale con el formato de error único (AGENTS.md §4).
    defaultHook: validationHook<AppBindings>(),
  });

  // Middleware base. OJO: no loguear cuerpos, headers ni datos sensibles (AGENTS.md §5).
  app.use("*", logger());
  app.use("*", secureHeaders());

  // Manejador global de errores → respuesta consistente, sin filtrar internals.
  app.onError(errorHandler);

  // --- Dominios (un router por feature, AGENTS.md §4) ---
  app.route("/health", healthRouter);
  app.route("/auth", authRouter);
  app.route("/plans", plansRouter);
  app.route("/capital", capitalRouter);
  app.route("/portfolio", portfolioRouter);
  app.route("/brokers", brokersRouter);

  // Esquema de seguridad para el spec OpenAPI (Bearer JWT de Supabase Auth).
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  // --- Documentación: protegida por entorno (AGENTS.md §4/§9) ---
  // El guard se registra ANTES que cada ruta para envolverla.
  app.use(OPENAPI_JSON_PATH, docsGuard);
  app.use("/reference", docsGuard);
  app.use("/docs", docsGuard);

  app.doc(OPENAPI_JSON_PATH, openApiConfig);
  app.get("/reference", Scalar({ url: OPENAPI_JSON_PATH, pageTitle: "Investep App API" }));
  app.get("/docs", swaggerUI({ url: OPENAPI_JSON_PATH }));

  return app;
}

export type App = ReturnType<typeof createApp>;
