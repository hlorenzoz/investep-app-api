#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Servicio one-shot: aplica supabase/migrations/*.sql al Postgres del stack de
# forma INCREMENTAL, registrando cada migración aplicada en un ledger.
#
# Por qué no se montan en el initdb del contenedor `db`: las migraciones del
# proyecto referencian `auth.users` (FK), que la crea GoTrue (servicio `auth`)
# en runtime, DESPUÉS del initdb. Por eso este servicio espera a que `auth.users`
# exista y recién ahí aplica el schema + seeds.
#
# Ledger: `supabase_migrations.schema_migrations` (schema dedicado, NO expuesto
# por PostgREST → solo publica `public`). Cada archivo se aplica una única vez.
# Antes esto usaba un guard todo-o-nada ("si existe public.brokers, no hacer
# nada"), que dejaba SIN aplicar cualquier migración agregada sobre un volumen
# existente. Ahora, para cada migración que no esté en el ledger se usa una
# estrategia apply-and-tolerate (ver paso 3), robusta ante volúmenes frescos,
# completos o drifteados — sin re-correr las viejas ni enmascarar drift real.
#
# Conecta como `postgres` (superuser) → puede crear y hacer GRANT a
# service_role / authenticated / anon (roles creados por volumes/db/roles.sql).
# ---------------------------------------------------------------------------
set -euo pipefail

DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-postgres}"

# SQLSTATE de la familia "objeto duplicado": indican que una migración no idempotente YA
# está aplicada (CREATE sin IF NOT EXISTS re-corrido). Se matchean sobre la salida de psql
# con VERBOSITY=verbose (que imprime "ERROR:  42P07: ..."). Es LOCALE-INDEPENDENT: el código
# nunca se traduce, a diferencia del texto "already exists". (No forzamos lc_messages porque
# el rol `postgres` de Supabase self-hosted no es superuser y no puede setearlo.)
#   42P07 tabla/índice/vista · 42710 constraint/trigger/policy/type · 42701 columna
#   42723 función · 42P06 schema · 42P04 database
DUPLICATE_SQLSTATES="42P07|42710|42701|42723|42P06|42P04"

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

# 2) Ledger de migraciones aplicadas (schema dedicado, no expuesto por la Data API).
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "create schema if not exists supabase_migrations;"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);"

# 3) Conciliar cada migración que no esté en el ledger, en orden lexical.
#    Estrategia apply-and-tolerate, robusta ante cualquier estado del volumen:
#      - pendiente     → aplica limpio; el `-f` de la migración y el INSERT al ledger
#                        van en UNA sola transacción (--single-transaction), así nunca
#                        queda "aplicada pero sin registrar" (que rompería el próximo
#                        run al re-aplicar DDL no idempotente).
#      - ya aplicada   → el re-run choca con "already exists" (los CREATE no usan IF NOT
#                        EXISTS); se tolera y se registra en el ledger (concilia volúmenes
#                        legacy que aún no tenían ledger).
#      - error genuino → cualquier otro fallo (p. ej. una dependencia faltante por drift
#                        real) ABORTA fuerte y lo imprime, en vez de enmascararlo.
echo "[migrate] conciliando migraciones con el ledger..."
applied=0
reconciled=0
errfile="$(mktemp)"
trap 'rm -f "$errfile"' EXIT

for f in $(ls /migrations/*.sql | sort); do
  v="$(basename "$f")"
  if [ -n "$(psql "$DB_URL" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$v'")" ]; then
    continue
  fi

  # Apply + registro atómicos: si el archivo aplica OK, la fila del ledger se
  # commitea en la MISMA transacción (psql ejecuta -f y -c en orden). VERBOSITY=verbose
  # hace que un error imprima su SQLSTATE ("ERROR:  42P07: ..."), que clasificamos abajo.
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction \
       -f "$f" \
       -c "insert into supabase_migrations.schema_migrations (version) values ('$v');" \
       >/dev/null 2>"$errfile"; then
    echo "[migrate] -> aplicada $v"
    applied=$((applied + 1))
    continue
  fi

  # Falló: ¿es porque los objetos ya existen (migración ya aplicada, pre-ledger)? Se detecta
  # por SQLSTATE de duplicado (locale-independent); "already exists" queda como red de seguridad.
  if grep -qE "ERROR: +(${DUPLICATE_SQLSTATES}):" "$errfile" || grep -qi "already exists" "$errfile"; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
      -c "insert into supabase_migrations.schema_migrations (version) values ('$v') on conflict do nothing;"
    echo "[migrate] -> ya aplicada, conciliada en el ledger: $v"
    reconciled=$((reconciled + 1))
    continue
  fi

  # Cualquier otro error → drift real o migración rota: cortar fuerte, no enmascarar.
  echo "[migrate] ERROR aplicando $v (no es un conflicto 'already exists'):" >&2
  cat "$errfile" >&2
  exit 1
done

echo "[migrate] OK — ${applied} aplicada(s), ${reconciled} conciliada(s) con el ledger."
