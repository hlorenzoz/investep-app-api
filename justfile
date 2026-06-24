# Investep App API — task runner (AGENTS.md §8)
# Punto de entrada único para tareas. Todo vía Bun (NO npm/npx/yarn/pnpm).

set shell := ["bash", "-uc"]

# Lista las recetas disponibles
default:
    @just --list

# Instalar dependencias
install:
    bun install

# Desarrollo local (Cloudflare Workers via Wrangler)
dev:
    bunx wrangler dev

# Tests unitarios y de contrato (excluye e2e/, que corre con Playwright)
test:
    bun test src tests

# Tests E2E (Playwright API testing). Requiere `just supabase-start` + la API accesible.
e2e:
    bunx playwright test

# Prueba REAL de la integración con Resend: envía un correo de verificación.
# Uso: `just email-test alguien@dominio.com` o `just email-test` (usa RESEND_TEST_TO de `.dev.vars`).
email-test EMAIL="":
    bun run scripts/send-test-email.ts {{EMAIL}}

# Lint + typecheck
lint:
    bunx biome check .
    bunx tsc --noEmit

# Formatear código
format:
    bunx biome format --write .

# Autofix lint + format
fix:
    bunx biome check --write .

# Generar tipos de los bindings de Wrangler (worker-configuration.d.ts)
typegen:
    bunx wrangler types

# URLs de documentación (con `just dev` corriendo)
docs:
    @echo "Scalar (referencia): http://localhost:8787/reference"
    @echo "Swagger UI:          http://localhost:8787/docs"
    @echo "OpenAPI spec:        http://localhost:8787/openapi.json"

# Desplegar a Cloudflare (entorno por defecto)
deploy:
    bunx wrangler deploy

# --- Environments: staging / production (proyectos Supabase cloud separados) ---

# Correr local apuntando a STAGING (toma .dev.vars.staging y el env staging de wrangler.jsonc)
dev-staging:
    bunx wrangler dev --env staging

# Desplegar a staging / production (cuando los recursos cloud estén listos)
deploy-staging:
    bunx wrangler deploy --env staging

deploy-production:
    bunx wrangler deploy --env production

# Aplicar las migraciones al proyecto Supabase ENLAZADO (corré `supabase link --project-ref <ref>` antes)
db-push:
    supabase db push

# Cargar TODO como secrets en Workers desde el .dev.vars.<env> (todo-secret).
# El mismo archivo sirve para `wrangler dev --env` (local) y para esto (deploy).
secrets-staging:
    bunx wrangler secret bulk .dev.vars.staging --env staging

secrets-production:
    bunx wrangler secret bulk .dev.vars.production --env production

# Correr los hooks de pre-commit sobre todo el repo
precommit:
    pre-commit run --all-files

# --- Supabase (stack local en Docker) ---

# Levantar Supabase local en Docker (excluye Storage/Realtime/analytics que no usamos)
supabase-start:
    supabase start -x storage-api,imgproxy,realtime,edge-runtime,vector

# Parar el stack local (conserva los datos del volumen)
supabase-stop:
    supabase stop

# Estado y credenciales del stack local (URL, anon/service keys, Studio)
supabase-status:
    supabase status

# Resetear la base local: re-aplica migraciones + seed. DESTRUCTIVO.
supabase-reset:
    supabase db reset

# Abrir el dashboard local (Supabase Studio) en el navegador
supabase-studio:
    open http://127.0.0.1:54323

# Generar tipos TypeScript del schema local (regenerar tras cada migración)
supabase-types:
    supabase gen types typescript --local > src/types/database.types.ts

# --- Docker (API local sobre Bun, para integrar con Flutter) ---

# Levantar la API en Docker (requiere `just supabase-start` corriendo aparte)
docker-up:
    docker compose up --build -d

# Desarrollo con hot reload (Docker Compose Watch: sync de src/ + rebuild si cambian deps)
watch:
    docker compose watch

# Ver logs de la API en Docker
docker-logs:
    docker compose logs -f api

# Bajar la API en Docker
docker-down:
    docker compose down
