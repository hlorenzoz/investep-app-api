#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Servicio one-shot: aplica supabase/migrations/*.sql al Postgres del stack.
#
# Por qué no se montan en el initdb del contenedor `db`: las migraciones del
# proyecto referencian `auth.users` (FK), que la crea GoTrue (servicio `auth`)
# en runtime, DESPUÉS del initdb. Por eso este servicio espera a que `auth.users`
# exista y recién ahí aplica el schema + seeds (igual que hacía `supabase db reset`).
#
# Conecta como `postgres` (superuser) → puede crear y hacer GRANT a
# service_role / authenticated / anon (roles creados por volumes/db/roles.sql).
# ---------------------------------------------------------------------------
set -euo pipefail

DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-postgres}"

# 1) Esperar a que GoTrue haya creado auth.users (timeout ~120s).
#    (to_regclass devuelve NULL→vacío si no existe; chequeamos no-vacío.)
echo "[migrate] esperando auth.users..."
for i in $(seq 1 120); do
  if [ -n "$(psql "$DB_URL" -tAc "select to_regclass('auth.users')")" ]; then
    echo "[migrate] auth.users presente (intento $i)."
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "[migrate] TIMEOUT esperando auth.users — ¿arrancó el servicio auth?" >&2
    exit 1
  fi
  sleep 1
done

# 2) Guard de idempotencia: si el schema de la app ya está, no reaplicar.
#    (Las migraciones usan CREATE TABLE sin IF NOT EXISTS → fallarían en re-run.)
#    Un reset real es `docker compose down -v` + `up` (volumen fresco).
#    Nota: to_regclass('public.brokers') devuelve 'brokers' (public está en el
#    search_path), así que comparamos por no-vacío, no por el nombre calificado.
if [ -n "$(psql "$DB_URL" -tAc "select to_regclass('public.brokers')")" ]; then
  echo "[migrate] schema ya aplicado (public.brokers existe) — nada que hacer."
  exit 0
fi

# 3) Aplicar migraciones + seeds en orden lexical (los *_seed.sql son timestamped
#    e idempotentes con on conflict do nothing). Cada archivo en una transacción.
echo "[migrate] aplicando migraciones..."
for f in $(ls /migrations/*.sql | sort); do
  echo "[migrate] -> $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f"
done

echo "[migrate] OK — migraciones y seeds aplicados."
