# investep-app-api

API REST de **Investep App** — backend central que consumen los clientes (Flutter y SvelteKit).

Stack: **Hono** + **Zod OpenAPI Hono** sobre **Cloudflare Workers**, gestionado con **Bun** y
**Just**. Documentación generada con **Scalar** + **Swagger UI**. Ver [`AGENTS.md`](./AGENTS.md)
para el detalle completo de arquitectura, reglas de plataforma y seguridad.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.3 (gestor de paquetes y runtime de tooling — **no** npm/yarn/pnpm)
- [Just](https://github.com/casey/just) (runner de tareas)
- [pre-commit](https://pre-commit.com) (hooks de calidad)

## Arranque rápido

```bash
just install          # bun install
cp .dev.vars.example .dev.vars   # completá los secretos locales
just dev              # wrangler dev → http://localhost:8787
```

Endpoints de arranque:

- `GET /health` — health check (definido con Zod OpenAPI Hono).
- `GET /openapi.json` — spec OpenAPI (fuente de verdad de los clientes).
- `GET /reference` — referencia de API (Scalar).
- `GET /docs` — Swagger UI.

> La documentación (`/openapi.json`, `/reference`, `/docs`) está **protegida por entorno**: en
> `production` se bloquea salvo que se configure `DOCS_TOKEN` (ver [`AGENTS.md`](./AGENTS.md) §4/§9).

## Tareas (Just)

```bash
just lint     # biome check + tsc --noEmit
just format   # biome format --write
just fix      # biome check --write (autofix)
just test     # bun test
just typegen  # genera tipos de bindings de Wrangler
just deploy   # wrangler deploy
```

## Estructura

```
src/
├── index.ts              # entry del Worker
├── app.ts               # createApp(): OpenAPIHono + middleware + docs
├── types/               # Env (bindings) y tipos de la app
├── lib/                 # errores, config OpenAPI, cliente Supabase
├── middleware/          # error-handler, docs-guard
├── schemas/             # esquemas Zod compartidos (ErrorSchema)
└── features/            # un dominio por carpeta (auth, plans, portfolio, brokers)
    └── health/          # patrón de referencia, completamente cableado
```

Para agregar un endpoint, seguí el patrón de `features/health/`: esquema + ruta (`createRoute`),
handler tipado, router (`.openapi(...)`) y test. **Toda** entrada externa se valida con Zod.
