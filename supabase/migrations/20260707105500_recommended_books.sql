-- Libros recomendados (lista curada de investepacademy.com/librostransformacion).
-- Entidad independiente de products: no se vende nada, cada libro apunta a un enlace
-- externo (búsqueda del audiolibro en YouTube o ficha de Amazon). `image` es un path
-- relativo a assets/images/ con extensión (mismo contrato que products.image; NO una URL
-- absoluta como brokers.logo). `sort_order` preserva el orden editorial de la página; la
-- API lista por sort_order, no alfabéticamente.
--
-- Seguridad: RLS deny-all (force + revoke), igual que products — todo acceso pasa por
-- la API con service-role (recommended-books.service.ts), sin exposición PostgREST directa.

create table public.recommended_books (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  title         text not null,
  author        text not null,
  description   text not null,
  url           text not null,
  image         text not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint recommended_books_slug_format check (slug ~ '^[a-z0-9_-]+$'),
  constraint recommended_books_url_check check (url ~ '^https?://')
);

create index recommended_books_sort_order_idx on public.recommended_books (sort_order);

create trigger recommended_books_set_updated_at before update on public.recommended_books
  for each row execute function public.set_updated_at();

-- RLS deny-all: sin políticas; acceso solo por service-role (la API sirve la lista).
alter table public.recommended_books enable row level security;
alter table public.recommended_books force row level security;
revoke all on public.recommended_books from anon, authenticated;
grant select, insert, update, delete on public.recommended_books to service_role;
