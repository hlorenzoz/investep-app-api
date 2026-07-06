-- Catálogo de la tienda (books/tshirts/caps). Cada producto se ofrece de una de dos formas
-- —precio definido o enlace directo a Amazon— y al menos una debe estar definida (CHECK
-- "defense in depth" que replica el refine de Zod en products.routes.ts). gender/theme son
-- atributos de variante que SOLO aplican a category='tshirt' (patrón
-- trade_operations_typed_fields_check, pero de una sola dirección: no exige que todo tshirt
-- tenga gender/theme, solo prohíbe que un book/cap los tenga — ver ADR-2 de design.md).
--
-- Seguridad: RLS deny-all (force + revoke), igual que trade_operations — el catálogo entero
-- se sirve vía service-role desde la API (products.service.ts), no expuesto a anon/authenticated
-- directamente por PostgREST (a diferencia de brokers, que sí tiene policy de lectura).

create table public.products (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  name          text not null,
  description   text,
  category      text not null,
  gender        text,
  theme         text,
  price         numeric(12, 2) check (price > 0),
  currency      text not null default 'USD',
  amazon_url    text,
  image         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_slug_format check (slug ~ '^[a-z0-9_-]+$'),
  constraint products_category_check check (category in ('book', 'tshirt', 'cap')),
  constraint products_gender_check check (gender in ('men', 'women')),
  constraint products_theme_check check (theme in ('light', 'dark')),
  constraint products_amazon_url_check check (amazon_url is null or amazon_url ~ '^https?://'),
  -- Regla central: precio o Amazon, al menos uno.
  constraint products_price_or_amazon_check check (price is not null or amazon_url is not null),
  -- Variantes tipadas: gender/theme prohibidos fuera de tshirt (permitidos, no obligatorios, dentro).
  constraint products_typed_variant_check check (
    category = 'tshirt' or (gender is null and theme is null)
  )
);

create index products_category_idx on public.products (category);
create index products_active_idx on public.products (active);

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- RLS deny-all: sin políticas; acceso solo por service-role (la API sirve el catálogo).
alter table public.products enable row level security;
alter table public.products force row level security;
revoke all on public.products from anon, authenticated;
grant select, insert, update, delete on public.products to service_role;
