-- Agregar plan para opciones al 35% mensual (options 35%)
insert into public.investment_plans (account_type, target_monthly_pct)
values ('options', 35.00)
on conflict (account_type, target_monthly_pct) do nothing;

insert into public.investment_plan_translations (investment_plan_id, locale, label)
select p.id, t.locale, t.label
from (
  values
    ('options'::text, 35.00::numeric(5, 2), 'es'::text, 'Opciones 35% mensual'::text),
    ('options',       35.00,                'en',        'Options 35% monthly')
) as t (account_type, target_monthly_pct, locale, label)
join public.investment_plans p
  on p.account_type = t.account_type
 and p.target_monthly_pct = t.target_monthly_pct
on conflict (investment_plan_id, locale) do nothing;
