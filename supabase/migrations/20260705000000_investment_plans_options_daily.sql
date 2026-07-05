-- Completa target_daily_pct para OPCIONES y corrige sus labels ("mensual" -> "diario").
--
-- Contexto de dominio (ver docs/investment-plans-returns.md):
--   - Activos (equity): el % del plan es MENSUAL; target_daily_pct = mensual / 20 (ya lo hace el trigger).
--   - Opciones (options): el % del plan es DIARIO (se busca esa rentabilidad diaria sobre el 10% del
--     capital). Es decir, para opciones `target_monthly_pct` es un MISNOMER: guarda un valor diario.
--
-- Esta migración: (1) extiende el trigger para que opciones complete target_daily_pct = target_monthly_pct
-- (el número guardado ES el diario), (2) backfillea las opciones ya sembradas (35 y 50), y (3) corrige
-- las traducciones a "diario"/"daily". Idempotente.

-- 1) Trigger: agrega la rama de opciones (antes hacía `return new` y dejaba NULL).
--    Mantiene los mismos guardas de override que equity (permite fijar el diario a mano).
create or replace function public.set_investment_plan_daily_pct()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_type = 'equity' then
    -- Activos: diario = mensual / 20 (20 días hábiles, división simple).
    if tg_op = 'INSERT' then
      if new.target_daily_pct is null then
        new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
      end if;
    else
      if new.target_monthly_pct is distinct from old.target_monthly_pct
         and new.target_daily_pct is not distinct from old.target_daily_pct then
        new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
      elsif new.target_daily_pct is null then
        new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
      end if;
    end if;

  elsif new.account_type = 'options' then
    -- Opciones: target_monthly_pct GUARDA el diario (misnomer). El diario ES ese número.
    if tg_op = 'INSERT' then
      if new.target_daily_pct is null then
        new.target_daily_pct := new.target_monthly_pct;
      end if;
    else
      if new.target_monthly_pct is distinct from old.target_monthly_pct
         and new.target_daily_pct is not distinct from old.target_daily_pct then
        new.target_daily_pct := new.target_monthly_pct;
      elsif new.target_daily_pct is null then
        new.target_daily_pct := new.target_monthly_pct;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 2) Backfill de las opciones ya cargadas (35, 50) que quedaron en NULL.
update public.investment_plans
set target_daily_pct = target_monthly_pct
where account_type = 'options'
  and target_daily_pct is null;

-- 3) Corrige las traducciones de opciones: "mensual"/"monthly" -> "diario"/"daily".
update public.investment_plan_translations t
set label = v.label
from (
  values
    ('options'::text,  50.00::numeric(5, 2), 'es'::text, 'Opciones 50% diario'::text),
    ('options',        50.00,                'en',        'Options 50% daily'),
    ('options',        35.00,                'es',        'Opciones 35% diario'),
    ('options',        35.00,                'en',        'Options 35% daily')
) as v (account_type, target_monthly_pct, locale, label)
join public.investment_plans p
  on p.account_type = v.account_type
 and p.target_monthly_pct = v.target_monthly_pct
where t.investment_plan_id = p.id
  and t.locale = v.locale;
