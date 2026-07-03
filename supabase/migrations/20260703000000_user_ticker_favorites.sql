-- Activos favoritos por usuario. Cada usuario marca sus propios tickers favoritos
-- (los tickers relacionados x2/x3/inverso son a su vez tickers, así que quedan cubiertos).
-- Datos de usuario: RLS deny-all + service-role; la API filtra por user_id (patrón del repo).
create table public.user_ticker_favorites (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  ticker_id  bigint not null references public.tickers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ticker_id)
);

-- Búsqueda inversa (¿quién marcó este ticker?) y para borrados en cascada eficientes.
create index user_ticker_favorites_ticker_id_idx on public.user_ticker_favorites (ticker_id);

-- RLS deny-all: sin políticas; acceso solo por service-role (la API filtra por user_id).
alter table public.user_ticker_favorites enable row level security;
alter table public.user_ticker_favorites force row level security;
revoke all on public.user_ticker_favorites from anon, authenticated;
grant select, insert, update, delete on public.user_ticker_favorites to service_role;
