#!/usr/bin/env bash
# Code review con IA (Gentleman Guardian Angel) — SOLO en la branch `devel`, en el pre-push.
# Usa AGENTS.md como reglas de revisión (.gga → RULES_FILE="AGENTS.md", STRICT_MODE="true").
# En cualquier otra branch no hace nada.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$branch" != "devel" ]; then
  echo "gga: omitido (branch '${branch:-?}' ≠ devel)"
  exit 0
fi

if ! command -v gga >/dev/null 2>&1; then
  echo "gga: no instalado — instalá Gentleman Guardian Angel para la review en devel." >&2
  exit 1
fi

echo "gga: code review con IA (reglas de AGENTS.md)…"
gga run --ci || {
  echo "gga: WARNING: La revisión de código con IA falló (posible problema de autenticación o del proveedor externo). Continuando push..." >&2
  exit 0
}
