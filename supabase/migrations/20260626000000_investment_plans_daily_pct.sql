-- Meta de rentabilidad diaria por plan, calculada sobre 20 días hábiles (4 semanas × 5 días).
-- Solo aplica a acciones (equity): target_daily_pct = target_monthly_pct / 20 (división simple).
--   25% -> 1.25%, 50% -> 2.50%, 100% -> 5.00%.
-- Opciones (options) queda en NULL: tendrán otra fórmula y se definen aparte.
-- Lo mantiene un trigger BEFORE INSERT OR UPDATE:
--   - INSERT: calcula solo si el diario no vino definido (permite override manual).
--   - UPDATE: recalcula si cambió el mensual y el diario no se tocó explícitamente
--     en ese mismo update (un diario seteado a mano gana; setearlo a NULL fuerza recálculo).

-- Columna nueva (nullable: options se queda en NULL hasta definir su fórmula).
alter table public.investment_plans
  add column target_daily_pct numeric(5, 2);

alter table public.investment_plans
  add constraint investment_plans_target_daily_pct_positive
  check (target_daily_pct is null or target_daily_pct > 0);

-- Mantiene el diario de equity. Nombre genérico: la rama de options se sumará acá a futuro.
create or replace function public.set_investment_plan_daily_pct()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Solo acciones (equity); opciones queda NULL hasta definir su fórmula.
  if new.account_type <> 'equity' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Al insertar: calcular solo si el diario no vino definido (permite override manual).
    if new.target_daily_pct is null then
      new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
    end if;
  else
    -- Al actualizar: recalcular si cambió el mensual y el diario no se tocó en este update.
    -- Un diario cambiado a mano en el mismo update gana; setearlo a NULL fuerza el recálculo.
    if new.target_monthly_pct is distinct from old.target_monthly_pct
       and new.target_daily_pct is not distinct from old.target_daily_pct then
      new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
    elsif new.target_daily_pct is null then
      new.target_daily_pct := round(new.target_monthly_pct / 20, 2);
    end if;
  end if;

  return new;
end;
$$;

create trigger investment_plans_set_daily_pct
  before insert or update on public.investment_plans
  for each row execute function public.set_investment_plan_daily_pct();

-- Backfill de los planes de equity ya cargados (25/50/100 -> 1.25/2.50/5.00).
update public.investment_plans
set target_daily_pct = round(target_monthly_pct / 20, 2)
where account_type = 'equity'
  and target_daily_pct is null;
