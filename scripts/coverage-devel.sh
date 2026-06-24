#!/usr/bin/env bash
# Gate de cobertura — se ejecuta SOLO en la branch `devel` (AGENTS.md §Testing).
# En cualquier otra branch no hace nada: la cobertura "se verifica en el pipeline de devel".
#
# El umbral (objetivo: 100% de líneas y funciones) se configura en `bunfig.toml`
# (`[test] coverageThreshold`). Mientras el umbral no esté activo, esto solo REPORTA.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

if [ "$branch" != "devel" ]; then
  echo "coverage: omitido (branch '${branch:-?}' ≠ devel)"
  exit 0
fi

echo "coverage: verificando en branch devel…"
exec bun test --coverage
