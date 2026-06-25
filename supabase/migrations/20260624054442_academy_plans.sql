-- Investep Academy — planes de adquisición (membresías) + matriz de features.
-- Entidad SEPARADA de investment_plans (targets de rentabilidad de las cuentas).
--
-- i18n: el texto visible (name/subtitle de los tiers, label de las features) vive
-- en tablas *_translations referenciando locales(code). Idioma base 'es'.
--
-- · Catálogos y traducciones: lectura para autenticados, escritura solo service role.
-- · academy_memberships: dato de usuario → deny-by-default, solo service role (API).
--   Preparada para importar miembros legacy: acquired_at histórico + source + external_ref.

-- ============================================================
-- Catálogo: investep_plans (tiers: bronze / silver / gold / platinum)
-- El texto visible (name, subtitle) está en investep_plan_translations.
-- ============================================================
create table public.investep_plans (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  price_regular  numeric(10, 2) not null,
  price_offer    numeric(10, 2),
  currency       text not null default 'USD',
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint investep_plans_slug_format check (slug ~ '^[a-z0-9_-]+$'),
  constraint investep_plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint investep_plans_price_regular_pos check (price_regular >= 0),
  constraint investep_plans_price_offer_pos check (price_offer is null or price_offer >= 0)
);

create table public.investep_plan_translations (
  investep_plan_id  bigint not null references public.investep_plans (id) on delete cascade,
  locale            text not null references public.locales (code),
  name              text not null,
  subtitle          text,
  primary key (investep_plan_id, locale)
);

create index investep_plan_translations_locale_idx
  on public.investep_plan_translations (locale);

-- ============================================================
-- Catálogo: investep_features (cada fila de la matriz de la imagen)
-- El texto visible (label) está en investep_feature_translations.
-- ============================================================
create table public.investep_features (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint investep_features_slug_format check (slug ~ '^[a-z0-9_-]+$')
);

create table public.investep_feature_translations (
  investep_feature_id bigint not null references public.investep_features (id) on delete cascade,
  locale              text not null references public.locales (code),
  label               text not null,
  primary key (investep_feature_id, locale)
);

create index investep_feature_translations_locale_idx
  on public.investep_feature_translations (locale);

-- ============================================================
-- investep_plan_features (M:N — qué features incluye cada tier, los ✓)
-- ============================================================
create table public.investep_plan_features (
  investep_plan_id     bigint not null references public.investep_plans (id) on delete cascade,
  investep_feature_id  bigint not null references public.investep_features (id) on delete cascade,
  primary key (investep_plan_id, investep_feature_id)
);

-- El lado plan_id ya queda indexado por la PK compuesta; falta el lado inverso.
create index investep_plan_features_feature_id_idx
  on public.investep_plan_features (investep_feature_id);

-- ============================================================
-- academy_memberships (el plan de academia del usuario — 1:1)
-- ============================================================
create table public.academy_memberships (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  investep_plan_id  bigint not null references public.investep_plans (id),
  status            text not null default 'active',
  source            text not null default 'signup',
  external_ref      text,
  acquired_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint academy_memberships_status_check check (status in ('active', 'expired', 'cancelled')),
  constraint academy_memberships_source_check check (source in ('signup', 'import', 'admin')),
  -- Idempotencia de importación: un mismo registro legacy no se importa dos veces.
  -- (UNIQUE permite múltiples NULL → las altas normales por signup no chocan.)
  constraint academy_memberships_external_ref_unique unique (external_ref)
);

create index academy_memberships_investep_plan_id_idx
  on public.academy_memberships (investep_plan_id);

-- ============================================================
-- Triggers updated_at (la función public.set_updated_at() ya existe)
-- ============================================================
create trigger investep_plans_set_updated_at before update on public.investep_plans
  for each row execute function public.set_updated_at();
create trigger investep_features_set_updated_at before update on public.investep_features
  for each row execute function public.set_updated_at();
create trigger academy_memberships_set_updated_at before update on public.academy_memberships
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — catálogos y traducciones: lectura autenticados, escritura solo service role
-- ============================================================
-- Grants explícitos (Supabase ya no auto-expone tablas nuevas — ver initial_schema).
-- service_role: DML completo. authenticated: SELECT para que la policy evalúe.
alter table public.investep_plans enable row level security;
create policy investep_plans_read_authenticated on public.investep_plans
  for select to authenticated using (true);
grant select on public.investep_plans to authenticated;
grant select, insert, update, delete on public.investep_plans to service_role;

alter table public.investep_plan_translations enable row level security;
create policy investep_plan_translations_read_authenticated on public.investep_plan_translations
  for select to authenticated using (true);
grant select on public.investep_plan_translations to authenticated;
grant select, insert, update, delete on public.investep_plan_translations to service_role;

alter table public.investep_features enable row level security;
create policy investep_features_read_authenticated on public.investep_features
  for select to authenticated using (true);
grant select on public.investep_features to authenticated;
grant select, insert, update, delete on public.investep_features to service_role;

alter table public.investep_feature_translations enable row level security;
create policy investep_feature_translations_read_authenticated on public.investep_feature_translations
  for select to authenticated using (true);
grant select on public.investep_feature_translations to authenticated;
grant select, insert, update, delete on public.investep_feature_translations to service_role;

alter table public.investep_plan_features enable row level security;
create policy investep_plan_features_read_authenticated on public.investep_plan_features
  for select to authenticated using (true);
grant select on public.investep_plan_features to authenticated;
grant select, insert, update, delete on public.investep_plan_features to service_role;

-- ============================================================
-- RLS — academy_memberships: dato de usuario → deny-by-default, solo service role
-- ============================================================
alter table public.academy_memberships enable row level security;
alter table public.academy_memberships force row level security;
revoke all on public.academy_memberships from anon, authenticated;
grant select, insert, update, delete on public.academy_memberships to service_role;
