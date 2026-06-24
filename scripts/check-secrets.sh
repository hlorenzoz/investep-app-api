#!/usr/bin/env bash
# Verifica que TODOS los secrets que el Worker necesita estén definidos en un entorno de
# Cloudflare ANTES de desplegar (AGENTS.md §5/§7). Única fuente de verdad de la lista:
# manténela en sync con src/types/env.ts y con los `.dev.vars.<env>` que cargás vía
# `just secrets-<env>`.
#
# Uso: bash scripts/check-secrets.sh <staging|production>
set -euo pipefail

env="${1:?uso: check-secrets.sh <staging|production>}"

# Secrets requeridos en runtime por el Worker.
required=(
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  DOCS_TOKEN
  RESEND_API_KEY
  RESEND_FROM
)

echo "secrets: verificando entorno '${env}'…"
listed="$(bunx wrangler secret list --env "$env")"

missing=0
for s in "${required[@]}"; do
  # Match por substring sobre el JSON de `wrangler secret list` (nombres sin solapamiento).
  if [[ "$listed" != *"$s"* ]]; then
    echo "  ✗ falta el secret: $s"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "secrets: faltan secrets en '${env}' (cargalos con 'just secrets-${env}')."
  exit 1
fi

echo "secrets: OK — todos presentes en '${env}'."
