-- Capa de planificación del usuario: capital total + asignación a cuentas de broker.
-- Distinta del feed read-only del agregador (broker_connections/accounts).
-- El profit de cada cuenta se vincula al catálogo investment_plans (FK compuesta,
-- igual que accounts), para poder elegir y cambiar de plan (25% -> 50% -> 100%).
--
-- Seguridad: RLS deny-all (force + revoke); el acceso es solo vía service-role y la
-- API filtra por user_id (patrón del repo para datos de usuario).

-- Capital total declarado por el usuario (1:1 con auth.users).
create table public.user_capital (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  total_capital  numeric(14, 2) not null check (total_capital >= 0),
  currency       text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Asignación de capital a un broker + tipo de cuenta + plan de profit.
create table public.broker_allocations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  broker_id          bigint not null references public.brokers (id),
  account_type       text not null,
  investment_plan_id bigint not null,
  initial_deposit    numeric(14, 2) not null check (initial_deposit >= 0),
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint broker_allocations_account_type_check check (account_type in ('equity', 'options')),
  -- FK compuesta: el plan debe corresponder al account_type (igual que accounts).
  constraint broker_allocations_plan_fk foreign key (investment_plan_id, account_type)
    references public.investment_plans (id, account_type),
  -- Una asignación por (broker, tipo de cuenta) por usuario; cambiar el plan es un update.
  constraint broker_allocations_user_broker_type_unique unique (user_id, broker_id, account_type)
);

create index broker_allocations_user_id_idx on public.broker_allocations (user_id);
create index broker_allocations_broker_id_idx on public.broker_allocations (broker_id);
create index broker_allocations_plan_id_idx on public.broker_allocations (investment_plan_id);

-- updated_at automático (reusa public.set_updated_at()).
create trigger user_capital_set_updated_at
  before update on public.user_capital
  for each row execute function public.set_updated_at();

create trigger broker_allocations_set_updated_at
  before update on public.broker_allocations
  for each row execute function public.set_updated_at();

-- RLS deny-all: sin políticas; acceso solo por service-role (la API filtra por user_id).
alter table public.user_capital enable row level security;
alter table public.user_capital force row level security;
revoke all on public.user_capital from anon, authenticated;

alter table public.broker_allocations enable row level security;
alter table public.broker_allocations force row level security;
revoke all on public.broker_allocations from anon, authenticated;
