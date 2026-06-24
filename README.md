# investep-app-api

API REST de **Investep App** — backend central que consumen los clientes (Flutter y SvelteKit).

Stack: **Hono** + **Zod OpenAPI Hono** sobre **Cloudflare Workers**, con **Supabase**
(Postgres + Auth) como base de datos, gestionado con **Bun** y **Just**. Documentación con
**Scalar** + **Swagger UI**. Ver [`AGENTS.md`](./AGENTS.md) para arquitectura, reglas de
plataforma y seguridad.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.3 (gestor de paquetes y runtime de tooling — **no** npm/yarn/pnpm)
- [Just](https://github.com/casey/just) (runner de tareas)
- [Docker](https://www.docker.com) (Supabase local + API en contenedor)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- [pre-commit](https://pre-commit.com) (hooks de calidad)

## Arranque rápido (entorno devel)

```bash
just install                     # bun install
just supabase-start              # Supabase local en Docker (Postgres + Auth + Studio) + migraciones
cp .dev.vars.example .dev.vars   # completá con las credenciales de `just supabase-status`

# Opción A — API en Docker (Bun) con hot reload, lista para integrar Flutter:
just watch                       # → http://localhost:8787

# Opción B — wrangler dev (runtime real de Workers) en el host:
just dev                         # → http://localhost:8787
```

> El entorno Docker corre la API sobre **Bun** (rápido para iterar); en producción el runtime es
> **Cloudflare Workers** (workerd). Es un entorno de integración local, no un mirror exacto.

### Conectar la app Flutter

| Cliente | Base URL de la API |
|---|---|
| Emulador Android | `http://10.0.2.2:8787` |
| Simulador iOS | `http://localhost:8787` |
| Dispositivo físico (misma red) | `http://<IP-LAN>:8787` |

## Endpoints

- `GET /health` — liveness.
- `GET /health/ready` — readiness (verifica API + conexión a Supabase).
- `GET /openapi.json` — spec OpenAPI (fuente de verdad de los clientes).
- `GET /reference` — referencia de API (Scalar).
- `GET /docs` — Swagger UI.

> Los dominios de negocio (`auth`, `plans`, `portfolio`, `brokers`) son **stubs** todavía: aún no
> exponen endpoints. La documentación está **protegida por entorno**: en `production` se bloquea
> salvo que se configure `DOCS_TOKEN` (ver [`AGENTS.md`](./AGENTS.md) §4/§9).

Para **agentes de IA / integración**, ver [`docs/api-for-agents.md`](./docs/api-for-agents.md) — auth,
formato de error, convenciones (i18n) y cómo descubrir endpoints vía `/openapi.json`.

## Base de datos (Supabase)

Las migraciones se versionan en [`supabase/migrations/`](./supabase/migrations). El acceso a datos
es vía `@supabase/supabase-js` (cliente HTTP/REST, tipado con los tipos generados). El texto visible
al usuario es **multilingüe** (tablas `*_translations` + `locales`, idioma base `es`).

```bash
just supabase-start    # levantar el stack local (aplica migraciones)
just supabase-status   # URL + keys locales + Studio
just supabase-studio   # abrir Studio → http://127.0.0.1:54323
just supabase-reset    # recrear la base local: migraciones + seed (DESTRUCTIVO)
just supabase-types    # generar src/types/database.types.ts (regenerar tras cada migración)
just supabase-stop     # parar el stack
```

## Entornos

| Entorno | Dónde corre | Supabase |
|---|---|---|
| **devel** | Docker (Bun) local | Supabase local (Docker) |
| **staging** | `wrangler dev/deploy --env staging` | proyecto cloud `investep-staging` |
| **production** | `wrangler deploy --env production` | proyecto cloud `investep` |

Los secretos por entorno viven en `.dev.vars.<env>` (gitignored; plantillas
`.dev.vars.<env>.example`). **Todo** se maneja como *secret* — incluida la URL/keys de Supabase —
nunca en el repo.

```bash
just dev-staging        # correr local apuntando a staging
just db-push            # aplicar migraciones al proyecto enlazado (supabase link --project-ref <ref> antes)
just secrets-staging    # cargar los secrets en Workers (wrangler secret bulk)
just deploy-staging     # desplegar a staging   (idem deploy-production)
```

## Docker

```bash
just docker-up      # levantar la API en Docker (requiere supabase-start aparte)
just watch          # idem + hot reload (Docker Compose Watch)
just docker-logs    # ver logs
just docker-down    # bajar
```

La imagen (`oven/bun:alpine`) se conecta a Supabase por la **red interna de Docker** y expone un
`healthcheck` contra `/health/ready`.

## Calidad

```bash
just lint     # biome check + tsc --noEmit
just format   # biome format --write
just fix      # biome check --write (autofix)
just test     # bun test src tests (unit + contrato)
just e2e      # Playwright API testing (e2e/; requiere supabase-start + API levantada)
just precommit  # hooks de pre-commit sobre todo el repo
just typegen  # tipos de los bindings de Wrangler
```

## Calidad y validación (pre-commit)

**No usamos GitHub Actions** — todo el control de calidad pasa por **pre-commit**, en cada branch.
Instalá los hooks (commit + push) **una sola vez**:

```bash
pre-commit install --install-hooks
```

| Etapa | Cuándo | Qué corre |
|---|---|---|
| `pre-commit` | al commitear | formato · **biome** (lint) · **tsc** (typecheck) · **gitleaks** (secrets) |
| `pre-push` | al pushear | **`bun test`** · cobertura (**solo `devel`**) · **deploy a Workers** (**solo `staging`**) |

- Los hooks de Biome/tsc/tests usan **Bun**, así que corren **localmente**. [pre-commit.ci](https://pre-commit.ci) complementa en PRs pero su entorno no tiene Bun → allá solo corren whitespace/gitleaks/yaml/json.
- **Cobertura:** objetivo **100%** (código + flujos), verificada en el `pre-push` de `devel` ([`scripts/coverage-devel.sh`](./scripts/coverage-devel.sh)). El *gate* se activa en `bunfig.toml` (`coverageThreshold`).
- **Deploy:** en **push a `staging`** el `pre-push` despliega a Workers (`--env staging`) si pasan los tests y existen los secrets del Worker (necesita `CLOUDFLARE_API_TOKEN` en tu entorno). **`production` es manual** (`just deploy-production`).

Reglas estrictas de código, tests y observabilidad: ver [`AGENTS.md`](./AGENTS.md) §4, §11 y §12.

## Estructura

```
src/
├── index.ts              # entry del Worker (Cloudflare / producción)
├── server.ts             # entry para Bun (Docker local)
├── app.ts                # createApp(): OpenAPIHono + middleware + docs
├── types/                # Env (bindings), AppBindings, database.types.ts (generado)
├── lib/                  # errores, config OpenAPI, cliente Supabase tipado
├── middleware/           # error-handler, docs-guard
├── schemas/              # esquemas Zod compartidos (ErrorSchema)
└── features/             # un dominio por carpeta (auth, plans, portfolio, brokers)
    └── health/           # patrón de referencia, completamente cableado
supabase/
├── config.toml           # config del stack local
└── migrations/           # migraciones versionadas (schema + RLS + seeds)
Dockerfile · compose.yaml # API local sobre Bun + healthcheck + compose watch
```

Para agregar un endpoint, seguí el patrón de `features/health/`: esquema + ruta (`createRoute`),
handler tipado, router (`.openapi(...)`) y test. **Toda** entrada externa se valida con Zod.
