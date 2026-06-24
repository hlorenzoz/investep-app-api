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

# Chequeo de secrets compartido (única fuente de verdad de la lista).
bash "$(dirname "$0")/check-secrets.sh" staging

echo "deploy: desplegando a Cloudflare Workers (staging)…"
exec bunx wrangler deploy --env staging
