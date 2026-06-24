#!/usr/bin/env bash
# Deploy a Cloudflare Workers — SOLO en la branch `staging`, en el pre-push, después de que
# pasen los tests (AGENTS.md §7). En cualquier otra branch no hace nada.
#
# Como corre en el pre-push, el push a staging SOLO se completa si el deploy funcionó.
# Requiere CLOUDFLARE_API_TOKEN en el entorno (o `wrangler login`). Verifica que los
# secrets del Worker estén definidos antes de subir (cargalos con `just secrets-staging`).
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$branch" != "staging" ]; then
  echo "deploy: omitido (branch '${branch:-?}' ≠ staging)"
  exit 0
fi

echo "deploy: verificando secrets del Worker (staging)…"
listed="$(bunx wrangler secret list --env staging)"
missing=0
for s in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DOCS_TOKEN; do
  if ! grep -qw "$s" <<< "$listed"; then
    echo "  ✗ falta el secret: $s"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "deploy ABORTADO: faltan secrets en staging (cargalos con 'just secrets-staging')."
  exit 1
fi

echo "deploy: desplegando a Cloudflare Workers (staging)…"
exec bunx wrangler deploy --env staging
