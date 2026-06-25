import { defineConfig } from "@playwright/test";

/**
 * Playwright en modo **API testing** (sin navegador): nuestra API es un backend REST,
 * así que los E2E usan el `request` context contra la API levantada de verdad.
 *
 * El `webServer` levanta la API local (Bun) con los secretos de `.dev.vars`. Requiere el
 * stack arriba (`just up`) para que `/health/ready` dé `up`.
 * Si ya hay una API escuchando en el puerto (el servicio `api` del stack), la reutiliza.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
  },
  webServer: {
    command: "bun --env-file=.dev.vars run src/server.ts",
    url: "http://localhost:8787/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
