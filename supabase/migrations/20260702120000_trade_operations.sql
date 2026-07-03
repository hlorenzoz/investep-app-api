-- Registro de operaciones (journal) por cuenta de bróker: órdenes puestas en el
-- mercado, tanto de activos (equity) como de opciones. Viven en la pestaña
-- "Registros" de cada cuenta (broker_allocations).
--
-- Modelado: tabla única con discriminador account_type que DEBE coincidir con el
-- de la cuenta dueña — FK compuesta (allocation_id, account_type), mismo patrón que
-- broker_allocations_plan_fk. Los derivados (total invertido, total venta, ganancia
-- $ y %, estado) NO se persisten: se calculan en la API desde los campos crudos.
--
-- Seguridad: RLS deny-all (force + revoke); acceso solo vía service-role y la API
-- filtra por user_id (patrón del repo para datos de usuario).

-- La FK compuesta requiere unicidad sobre (id, account_type) en broker_allocations.
alter table public.broker_allocations
  add constraint broker_allocations_id_account_type_unique unique (id, account_type);

create table public.trade_operations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  allocation_id      uuid not null,
  account_type       text not null,
  ticker             text not null,
  opened_at          timestamptz not null,
  quantity           numeric(14, 4) not null check (quantity > 0),
  buy_price          numeric(14, 4) not null check (buy_price > 0),
  limit_price        numeric(14, 4) check (limit_price > 0),
  strike             numeric(14, 4) check (strike > 0),
  expiration_date    date,
  contract_type      text,
  sold_at            timestamptz,
  sell_price         numeric(14, 4) check (sell_price >= 0),
  strategy           text,
  notes              text,
  url                text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint trade_operations_account_type_check check (account_type in ('equity', 'options')),
  constraint trade_operations_ticker_check check (ticker ~ '^[A-Z0-9.^-]{1,12}$'),
  constraint trade_operations_contract_type_check check (contract_type in ('call', 'put')),
  -- El tipo del registro coincide con el de la cuenta (patrón broker_allocations_plan_fk).
  constraint trade_operations_allocation_fk foreign key (allocation_id, account_type)
    references public.broker_allocations (id, account_type) on delete cascade,
  -- Coherencia por tipo: opciones exige strike/vencimiento/call-put;
  -- equity prohíbe los campos exclusivos de opciones.
  constraint trade_operations_typed_fields_check check (
    (
      account_type = 'options'
      and strike is not null
      and expiration_date is not null
      and contract_type is not null
    )
    or (
      account_type = 'equity'
      and strike is null
      and expiration_date is null
      and contract_type is null
    )
  ),
  -- Los contratos de opciones se operan en cantidades enteras.
  constraint trade_operations_options_qty_integer_check check (
    account_type <> 'options' or quantity = trunc(quantity)
  ),
  -- La venta se registra completa o no se registra: fecha y precio van juntos.
  constraint trade_operations_sale_pair_check check ((sold_at is null) = (sell_price is null))
);

create index trade_operations_user_id_idx on public.trade_operations (user_id);
-- La pestaña Registros lista por cuenta, más reciente primero.
create index trade_operations_allocation_opened_idx
  on public.trade_operations (allocation_id, opened_at desc);

-- updated_at automático (reusa public.set_updated_at()).
create trigger trade_operations_set_updated_at
  before update on public.trade_operations
  for each row execute function public.set_updated_at();

-- RLS deny-all: sin políticas; acceso solo por service-role (la API filtra por user_id).
alter table public.trade_operations enable row level security;
alter table public.trade_operations force row level security;
revoke all on public.trade_operations from anon, authenticated;
grant select, insert, update, delete on public.trade_operations to service_role;
