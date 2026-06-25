-- Catálogo de planes de profit (investment_plans) + labels i18n (es/en).
-- Tiers (confirmados con el usuario): activos (equity) = 25% / 50% / 100%; opciones = 50%.
-- target_monthly_pct = objetivo de retorno MENSUAL en %. Idempotente: on conflict do nothing.
-- Las labels son placeholder ajustable; los slugs naturales son (account_type, target_monthly_pct).

insert into public.investment_plans (account_type, target_monthly_pct)
values
  ('equity', 25.00),
  ('equity', 50.00),
  ('equity', 100.00),
  ('options', 50.00)
on conflict (account_type, target_monthly_pct) do nothing;

-- Labels traducidas. Se resuelve el id del plan por (account_type, target_monthly_pct).
insert into public.investment_plan_translations (investment_plan_id, locale, label)
select p.id, t.locale, t.label
from (
  values
    ('equity'::text,  25.00::numeric(5, 2), 'es'::text, 'Activos 25% mensual'::text),
    ('equity',        25.00,                'en',        'Equity 25% monthly'),
    ('equity',        50.00,                'es',        'Activos 50% mensual'),
    ('equity',        50.00,                'en',        'Equity 50% monthly'),
    ('equity',       100.00,                'es',        'Activos 100% mensual'),
    ('equity',       100.00,                'en',        'Equity 100% monthly'),
    ('options',       50.00,                'es',        'Opciones 50% mensual'),
    ('options',       50.00,                'en',        'Options 50% monthly')
) as t (account_type, target_monthly_pct, locale, label)
join public.investment_plans p
  on p.account_type = t.account_type
 and p.target_monthly_pct = t.target_monthly_pct
on conflict (investment_plan_id, locale) do nothing;
