#!/usr/bin/env bash
# Sincroniza los seeds de REFERENCIA (catálogos) en STAGING — SOLO en la branch `staging`,
# en el pre-push, ANTES del deploy del Worker (mismo patrón de gate que deploy-staging.sh).
# En cualquier otra branch no hace nada.
#
# QUÉ HACE (idempotente, re-ejecutable para sincronizar):
#   1. Aplica migraciones (traen planes / activos-tickers / catálogo base de brókers).
#   2. Upsert de los catálogos editables: brókers, tienda, libros recomendados.
#
# QUÉ **NO** TOCA: ninguna cuenta de usuario ni sus datos (profiles/capital/operaciones/
# membresías). No corre create-first-user / create-users-by-plan / create-demo-user. Los
# seeds de usuarios se hacen aparte y a mano con `just seed`. Los populate-* solo hacen
# upsert por slug sobre sus tablas de catálogo → cero filas de usuarios afectadas.
#
# PREREQUISITOS:
#   - Proyecto de Supabase LINKEADO a staging (`supabase link`) y `.dev.vars.staging` presente.
#   - El proyecto linkeado y el SUPABASE_URL de `.dev.vars.staging` deben ser el MISMO (staging).
#   - Si el CLI pide el password de la DB para el push, exportá SUPABASE_DB_PASSWORD.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$branch" != "staging" ]; then
  echo "seed(staging): omitido (branch '${branch:-?}' ≠ staging)"
  exit 0
fi

echo "seed(staging): [1/2] migraciones (supabase db push --linked)…"
pw_flag=()
[ -n "${SUPABASE_DB_PASSWORD:-}" ] && pw_flag=(-p "$SUPABASE_DB_PASSWORD")
bunx supabase db push --linked --yes "${pw_flag[@]}"

echo "seed(staging): [2/2] catálogos (brókers → tienda → libros)…"
bun run scripts/populate-brokers.ts staging
bun run scripts/populate-tienda.ts staging
bun run scripts/populate-recommended-books.ts staging

echo "seed(staging): OK — catálogos sincronizados. Sin cambios en datos de usuarios."
