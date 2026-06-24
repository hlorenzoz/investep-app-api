# Skill Registry — investep-app-api

> Generado por sdd-init. Convenciones del proyecto + skills disponibles para inyectar a sub-agentes.

## Project Conventions (compact rules)

Fuente: `AGENTS.md` (§1–§12) + `CLAUDE.md` (global). Reglas clave a inyectar en cada sub-agente que toque código:

- **Plataforma (Cloudflare Workers, no negociable)**: sin estado entre requests; sin TCP a Postgres (Supabase vía HTTP/REST); cómputo pesado a Queues/Cron; secrets por wrangler/`.dev.vars` (todo-secret, nunca en el repo).
- **Código (§4)**: TypeScript estricto **sin `any`**; TSDoc en módulos/funciones públicas; API-first con Zod OpenAPI Hono (`createRoute`); validar **toda** entrada con Zod; formato único de error (`lib/errors`); organizar por feature; refactor testable; DRY. Patrón de referencia: `features/health/`.
- **Tests (§11, obligatorio)**: **cada implementación lleva sus tests** en la misma entrega; `bun test`; gate de cobertura **95% (line+function)** en el pre-push de `devel`; tipos: caja blanca, contrato, negativos, seguridad, regresión, e2e. Strict TDD: enabled.
- **Seguridad (§5) y observabilidad (§12, fintech)**: tokens cifrados; brokers **SOLO LECTURA**; logging estructurado de errores y eventos de seguridad; **nunca** loguear tokens/credenciales/datos de cuenta.
- **Tooling (§7)**: Bun (no npm/npx/yarn/pnpm); Just; pre-commit es el ÚNICO pipeline (NO GitHub Actions). Deploy: staging automático (pre-push), production manual.

## User Skills (triggers)

| Skill | Cuándo usarlo |
|-------|---------------|
| `supabase-postgres-best-practices` | Escribir/optimizar queries, schema o RLS de Postgres/Supabase |
| `workers-best-practices` | Escribir/revisar código de Cloudflare Workers, `wrangler.jsonc` |
| `wrangler` | Comandos de Wrangler (dev, deploy, secrets, KV, R2) |
| `cloudflare` / `cloudflare-deploy` | Plataforma Cloudflare; despliegue a Workers |
| `durable-objects` | Estado coordinado / WebSockets en Workers |
| `tdd` / `test-driven-development` | Implementar feature o fix test-first |
| `security-best-practices` | Asegurar APIs (OWASP, CORS, rate limiting, auth) |
| `e2e-testing-patterns` | Tests E2E (Playwright/Cypress) — aún no instalado |
| `git-commit` / `branch-pr` / `issue-creation` | Workflow de commits / PRs / issues |

Convenciones de referencia: `AGENTS.md` (proyecto), `CLAUDE.md` (global).
