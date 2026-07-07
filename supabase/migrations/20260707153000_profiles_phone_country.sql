-- Datos de perfil del usuario: teléfono y país. Viven en `public.profiles` junto a
-- `full_name` (la tabla de perfil canónica), NO en `auth.users.user_metadata` — así el
-- dato de perfil queda en un solo lugar, consultable por SQL/PostgREST y desacoplado de
-- Auth (cuyo campo `phone` nativo es para OTP/SMS, semántica distinta).
--
-- Ambas columnas son nullable (opcionales): un perfil sin teléfono/país es válido.

alter table public.profiles add column phone text;
alter table public.profiles add column country text;
