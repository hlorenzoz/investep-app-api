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

# Tests E2E (Playwright API testing). Requiere el stack arriba (`just up`).
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

# Linkea el CLI de Supabase al proyecto cloud del entorno, derivando el project-ref del
# SUPABASE_URL de `.dev.vars.<env>` (https://<ref>.supabase.co → <ref>). Se corre UNA vez por
# máquina antes de `db-push` / el seed de staging. Requiere estar logueado (`supabase login`
# o SUPABASE_ACCESS_TOKEN) y pide el password de la DB (o tomalo de SUPABASE_DB_PASSWORD).
# Uso: `just db-link staging` | `just db-link production`.
db-link ENV:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ENV}}" in staging|production) ;; *) echo "ENV debe ser staging o production (no '{{ENV}}')"; exit 1;; esac
    envfile=".dev.vars.{{ENV}}"
    [ -f "$envfile" ] || { echo "No existe $envfile"; exit 1; }
    # Extrae SUPABASE_URL sin herramientas externas (bash puro; tolera comillas).
    url=""
    while IFS= read -r line; do
      case "$line" in SUPABASE_URL=*) url="${line#SUPABASE_URL=}" ;; esac
    done < "$envfile"
    url="${url%\"}"; url="${url#\"}"; url="${url%\'}"; url="${url#\'}"
    [ -n "$url" ] || { echo "Falta SUPABASE_URL en $envfile"; exit 1; }
    # https://<ref>.supabase.co → <ref>
    ref="${url#*://}"; ref="${ref%%.*}"
    echo "supabase link → '{{ENV}}' (project-ref: $ref)"
    # if/else (no array vacío) por compat con Bash 3.2 de macOS + `set -u`.
    if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
      bunx supabase link --project-ref "$ref" --password "$SUPABASE_DB_PASSWORD"
    else
      bunx supabase link --project-ref "$ref"
    fi

# Aplicar las migraciones al proyecto Supabase ENLAZADO (corré `just db-link <env>` antes)
db-push:
    bunx supabase db push

# Cargar TODO como secrets en Workers desde el .dev.vars.<env> (todo-secret).
# El mismo archivo sirve para `wrangler dev --env` (local) y para esto (deploy).
secrets-staging:
    bunx wrangler secret bulk .dev.vars.staging --env staging

secrets-production:
    bunx wrangler secret bulk .dev.vars.production --env production

# --- Aprovisionamiento de usuarios (CLI scripts) ---

# Crea el primer usuario admin usando BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD del
# archivo de entorno. ENV opcional: "" (local, .dev.vars) | staging | production.
# Uso: `just create-first-user` (local) | `just create-first-user staging`.
create-first-user ENV="":
    #!/usr/bin/env bash
    set -euo pipefail
    ef=""
    [ -n "{{ENV}}" ] && ef="--env {{ENV}}"
    bun run scripts/provision-user.ts $ef
    bun run scripts/set-admin.ts $ef

# Crea o resetea un usuario. PASSWORD vacío → el servidor genera la contraseña.
create-user EMAIL PASSWORD="":
    bun run scripts/provision-user.ts {{EMAIL}} {{PASSWORD}}

# Crea/actualiza las 4 cuentas demo por plan (bronze/silver/gold/platinum). Idempotente.
# Verificadas y sin cambio de contraseña forzado. ENV opcional: "" (local), staging, production.
create-users-by-plan ENV="":
    bun run scripts/create-users-by-plan.ts {{ENV}}

# Crea/actualiza el usuario demo (demo@hlorenzoz.com / "demo") con 2 cuentas (activos 25% +
# opciones 35%, 90/10) y ~1 mes de operaciones en cada una. Idempotente. ENV opcional.
create-demo-user ENV="":
    bun run scripts/create-demo-user.ts {{ENV}}

# Siembra/actualiza el catálogo de la tienda desde scripts/data/tienda-products.json
# (manifiesto editable a mano). Idempotente (upsert por slug). ENV opcional.
populate-tienda ENV="":
    bun run scripts/populate-tienda.ts {{ENV}}

# Siembra/actualiza el catálogo de brókers desde scripts/data/brokers.json
# (manifiesto editable a mano). Idempotente (upsert por slug). ENV opcional.
populate-brokers ENV="":
    bun run scripts/populate-brokers.ts {{ENV}}

# Siembra/actualiza los libros recomendados desde scripts/data/books.json
# (manifiesto editable a mano). Idempotente (upsert por slug). ENV opcional.
populate-recommended-books ENV="":
    bun run scripts/populate-recommended-books.ts {{ENV}}

# Seed COMPLETO de un entorno, en orden de dependencias. Un comando por rama:
#   just seed            # devel / local   (requiere el stack arriba: `just up`)
#   just seed staging    # staging
#   just seed production # main (pide confirmación)
# Aplica migraciones (traen planes / activos / brókers baseline) y luego siembra catálogos +
# usuarios. Idempotente: re-ejecutarlo SINCRONIZA (upserts). Prerequisitos cloud: que exista
# `.dev.vars.<env>` y que el proyecto de Supabase LINKEADO sea el del ENV (`supabase link`).
# Nota: reejecutar resetea contraseñas de admin/tier/demo y reenvía el email del admin.
seed ENV="":
    #!/usr/bin/env bash
    set -euo pipefail
    ENVARG="{{ENV}}"
    LABEL="${ENVARG:-local/devel}"
    echo "==> Seed del entorno: $LABEL"

    # Producción: confirmación explícita antes de migrar+sembrar la base productiva.
    if [ "$ENVARG" = "production" ]; then
      read -r -p "Vas a migrar + sembrar PRODUCCIÓN. Escribí 'production' para confirmar: " CONFIRM
      [ "$CONFIRM" = "production" ] || { echo "Cancelado."; exit 1; }
    fi

    # 1) Migraciones (planes, activos/tickers, catálogo base de brókers).
    if [ -z "$ENVARG" ]; then
      echo "==> [1/5] Migraciones (Docker migrate) — requiere el stack arriba (just up)"
      docker compose up migrate
    else
      echo "==> [1/5] Migraciones (supabase db push) — proyecto LINKEADO debe ser '$ENVARG'"
      bunx supabase db push
    fi

    # 2) Catálogos (idempotentes, upsert por slug).
    echo "==> [2/5] Catálogos: brókers, tienda, libros"
    bun run scripts/populate-brokers.ts "$ENVARG"
    bun run scripts/populate-tienda.ts "$ENVARG"
    bun run scripts/populate-recommended-books.ts "$ENVARG"

    # 3) Primer admin (provision + set-admin usan --env, no posicional).
    echo "==> [3/5] Primer admin (bootstrap)"
    ENVFLAG=""
    [ -n "$ENVARG" ] && ENVFLAG="--env $ENVARG"
    bun run scripts/provision-user.ts $ENVFLAG
    bun run scripts/set-admin.ts $ENVFLAG

    # 4) Usuarios por plan (necesita investep_plans + brókers + investment_plans).
    echo "==> [4/5] Usuarios por plan (bronze/silver/gold/platinum)"
    bun run scripts/create-users-by-plan.ts "$ENVARG"

    # 5) Usuario demo (necesita brókers + investment_plans, incl. options 35).
    echo "==> [5/5] Usuario demo (+ operaciones)"
    bun run scripts/create-demo-user.ts "$ENVARG"

    echo "==> Seed completo: $LABEL"

# Obtiene un access_token JWT para el usuario indicado (o el bootstrap por defecto).
# Passthrough a get-token.ts: acepta [EMAIL] [PASSWORD] y `--env <staging|production>`.
# Uso: `just token` | `just token --env staging` | `just token a@x.com pass --env production`.
token *ARGS:
    bun run scripts/get-token.ts {{ARGS}}

# Marca (o revoca con --revoke) a un usuario como admin: setea is_admin en app_metadata.
# Habilita el CRUD de catálogos (brokers/plans) tras `requireAdmin`. ENV opcional via --env.
# Uso: `just set-admin alguien@dominio.com` | `... --revoke` | `just set-admin` (usa BOOTSTRAP_ADMIN_EMAIL).
set-admin *ARGS:
    bun run scripts/set-admin.ts {{ARGS}}

# Asigna un usuario como administrador a partir de su correo electrónico.
make-admin EMAIL:
    bun run scripts/set-admin.ts {{EMAIL}}

# One-shot: migra must_reset_password de user_metadata → app_metadata (control de seguridad).
# Correr ANTES de desplegar el código que lee app_metadata. ENV opcional (staging/production).
migrate-must-reset ENV="":
    bun run scripts/migrate-must-reset-flag.ts {{ENV}}

# Correr los hooks de pre-commit sobre todo el repo
precommit:
    pre-commit run --all-files

# --- Pruebas de carga (k6) — ver load/README.md ---
# Requieren el stack arriba (`just up`) + el usuario admin (`just create-first-user`).
# El bridge scripts/k6-run.ts pasa los secretos por environment (no por la cmdline).

# Smoke SIN auth: liveness + readiness. Corre siempre (no requiere credenciales).
load-smoke:
    bun run scripts/k6-run.ts load/smoke.js

# Carga sostenida en endpoints de lectura (/capital, /plans). Requiere credenciales de usuario.
load:
    bun run scripts/k6-run.ts load/read-load.js

# Estrés creciente hasta saturar. Mismos prerrequisitos que `just load`.
load-stress:
    bun run scripts/k6-run.ts load/read-stress.js

# --- Stack local: Supabase self-hosting (oficial) + API, todo en Docker ---
# Primera vez: `cp .env.example .env`. Studio: http://127.0.0.1:54321 (basic-auth DASHBOARD_*).

alias docker-up := up
alias docker-down := down

# Levantar TODO el stack (Supabase + API + migraciones). Idempotente.
up:
    docker compose up --build -d

# Bajar el stack (conserva los datos del volumen)
down:
    docker compose down

# Estado de los contenedores del stack
status:
    docker compose ps

# Resetear la base: volumen fresco → re-aplica migraciones + seeds. DESTRUCTIVO.
db-reset:
    docker compose down -v
    docker compose up --build -d

# Abrir Supabase Studio (vía Kong; basic-auth DASHBOARD_USERNAME/PASSWORD del .env)
studio:
    open http://127.0.0.1:54321

# Generar tipos TS del schema (apunta al Postgres del stack en 127.0.0.1:54322)
types:
    supabase gen types typescript --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres > src/types/database.types.ts

# Desarrollo con hot reload (Docker Compose Watch: sync de src/ + rebuild si cambian deps)
watch:
    docker compose watch

# Ver logs de la API en Docker
docker-logs:
    docker compose logs -f api
