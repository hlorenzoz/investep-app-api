-- brokers: columnas de presentación (sitio + branding).
-- No es contenido traducible → viven inline en la tabla (igual que `name`),
-- NO en una tabla de traducciones.
--
-- `url` es obligatoria (todo broker tiene sitio). `url_secondary` (p. ej. dominio
-- regional .ie de IBKR) y los assets visuales (logo/favicon/icon) son opcionales.
-- `brokers` está vacía, así que agregar `url text not null` sin default es seguro.
--
-- Sin CHECK de formato a propósito: `logo` puede ser un data URI (`data:...`),
-- no necesariamente `https://`, así que un check de URL rompería ese caso.
alter table public.brokers
  add column url           text not null,
  add column url_secondary text,
  add column logo          text,
  add column favicon       text,
  add column icon          text;
