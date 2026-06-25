-- Investep — schema inicial
-- Jerarquía de dominio: auth.users → broker_connections → accounts → investment_plan
-- Catálogos: brokers, investment_plans.
-- (Los planes de adquisición de Investep Academy son otra entidad: investep_plans.)
--
-- i18n: el texto visible al usuario es multilingüe → vive en tablas *_translations
-- referenciando locales(code). El idioma base es 'es' (ver tabla locales).
--
-- Estrategia de acceso (decisión de arquitectura): TODO el acceso a datos de
-- usuario es vía la API con la service_role key. Por eso:
--   · RLS habilitado en todas las tablas (defensa en profundidad).
--   · Tablas de usuario: deny-by-default (sin políticas) + REVOKE a anon/authenticated.
--   · Catálogos / traducciones: lectura para autenticados, escritura solo service role.
-- Las credenciales cifradas del broker NO viven acá: van en tabla aparte / Supabase Vault.

-- ============================================================
-- Catálogo de idiomas soportados (i18n)
-- ============================================================
create table public.locales (
  code        text primary key,            -- BCP-47: 'es', 'en', 'pt-BR'…
  name        text not null,
  is_default  boolean not null default false
);

-- Garantiza un único idioma por defecto (fallback).
create unique index locales_single_default_idx on public.locales (is_default) where is_default;

insert into public.locales (code, name, is_default) values
  ('es', 'Español', true),
  ('en', 'English', false);

-- ============================================================
-- Catálogo: brokers (IBKR, eTrade, TastyTrade…)
-- ============================================================
create table public.brokers (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint brokers_slug_format check (slug ~ '^[a-z0-9_-]+$')
);

-- ============================================================
-- Catálogo: investment_plans (objetivo de rentabilidad mensual por tipo de cuenta)
-- El texto visible (label) está en investment_plan_translations.
-- ============================================================
create table public.investment_plans (
  id                  bigint generated always as identity primary key,
  account_type        text not null,
  target_monthly_pct  numeric(5, 2) not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint investment_plans_account_type_check check (account_type in ('equity', 'options')),
  constraint investment_plans_target_pct_positive check (target_monthly_pct > 0),
  constraint investment_plans_account_type_pct_unique unique (account_type, target_monthly_pct),
  -- Requerido como destino de la FK compuesta desde accounts (garantiza el match de tipo).
  constraint investment_plans_id_account_type_unique unique (id, account_type)
);

create table public.investment_plan_translations (
  investment_plan_id  bigint not null references public.investment_plans (id) on delete cascade,
  locale              text not null references public.locales (code),
  label               text not null,
  primary key (investment_plan_id, locale)
);

create index investment_plan_translations_locale_idx
  on public.investment_plan_translations (locale);

-- ============================================================
-- profiles (1:1 con auth.users) — extiende el usuario de Supabase Auth
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- broker_connections (la cuenta del usuario EN un broker)
-- ============================================================
create table public.broker_connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  broker_id   bigint not null references public.brokers (id),
  alias       text,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint broker_connections_status_check
    check (status in ('pending', 'active', 'revoked', 'error'))
);

-- Índices de FK (Postgres no los crea solo): aceleran joins y el ON DELETE CASCADE.
create index broker_connections_user_id_idx on public.broker_connections (user_id);
create index broker_connections_broker_id_idx on public.broker_connections (broker_id);

-- ============================================================
-- accounts (cada cuenta dentro del broker)
-- ============================================================
create table public.accounts (
  id                   uuid primary key default gen_random_uuid(),
  broker_connection_id uuid not null references public.broker_connections (id) on delete cascade,
  account_type         text not null,
  external_id          text not null,
  currency             text not null,
  investment_plan_id   bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint accounts_account_type_check check (account_type in ('equity', 'options')),
  constraint accounts_currency_check check (currency ~ '^[A-Z]{3}$'),
  -- FK compuesta: el plan de inversión DEBE ser del mismo account_type que la cuenta.
  -- investment_plan_id NULL ⇒ la FK no se evalúa (cuenta sin plan permitida).
  constraint accounts_investment_plan_fk foreign key (investment_plan_id, account_type)
    references public.investment_plans (id, account_type),
  -- Una misma cuenta externa no se repite dentro de la misma conexión.
  constraint accounts_conn_external_unique unique (broker_connection_id, external_id)
);

create index accounts_broker_connection_id_idx on public.accounts (broker_connection_id);
create index accounts_investment_plan_id_idx on public.accounts (investment_plan_id);

-- ============================================================
-- Trigger updated_at (search_path vacío → sin search_path injection)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brokers_set_updated_at before update on public.brokers
  for each row execute function public.set_updated_at();
create trigger investment_plans_set_updated_at before update on public.investment_plans
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger broker_connections_set_updated_at before update on public.broker_connections
  for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — datos de usuario: deny-by-default, solo service role (API)
-- ============================================================
-- Grants explícitos a service_role: Supabase desactivó el auto-expose de tablas
-- nuevas (config.toml api.auto_expose_new_tables sin setear → default nuevo del
-- cloud). Sin estos GRANT, PostgREST devuelve 42501 (permission denied) y la API
-- responde 500. El acceso a datos de usuario es SOLO vía service_role (la API
-- filtra por user_id); anon/authenticated quedan denegados (revoke + RLS).
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to service_role;

alter table public.broker_connections enable row level security;
alter table public.broker_connections force row level security;
revoke all on public.broker_connections from anon, authenticated;
grant select, insert, update, delete on public.broker_connections to service_role;

alter table public.accounts enable row level security;
alter table public.accounts force row level security;
revoke all on public.accounts from anon, authenticated;
grant select, insert, update, delete on public.accounts to service_role;

-- ============================================================
-- RLS — catálogos y traducciones: lectura autenticados, escritura solo service role
-- ============================================================
-- service_role: DML completo (la API lee y, eventualmente, administra catálogos).
-- authenticated: SELECT explícito para que la policy de lectura pueda evaluarse
-- (RLS necesita el GRANT de tabla además de la policy).
alter table public.locales enable row level security;
create policy locales_read_authenticated on public.locales
  for select to authenticated using (true);
grant select on public.locales to authenticated;
grant select, insert, update, delete on public.locales to service_role;

alter table public.brokers enable row level security;
create policy brokers_read_authenticated on public.brokers
  for select to authenticated using (true);
grant select on public.brokers to authenticated;
grant select, insert, update, delete on public.brokers to service_role;

alter table public.investment_plans enable row level security;
create policy investment_plans_read_authenticated on public.investment_plans
  for select to authenticated using (true);
grant select on public.investment_plans to authenticated;
grant select, insert, update, delete on public.investment_plans to service_role;

alter table public.investment_plan_translations enable row level security;
create policy investment_plan_translations_read_authenticated on public.investment_plan_translations
  for select to authenticated using (true);
grant select on public.investment_plan_translations to authenticated;
grant select, insert, update, delete on public.investment_plan_translations to service_role;
