-- Función para transferir capital entre asignaciones de broker y/o capital general.
-- p_from_id = null -> transferencia desde capital general (disponible).
-- p_to_id = null -> transferencia hacia capital general (liberar).
create or replace function public.transfer_capital(
  p_user_id uuid,
  p_from_id uuid,
  p_to_id uuid,
  p_amount numeric(14, 2)
)
returns void
language plpgsql
security definer
as $$
declare
  v_available numeric(14, 2);
  v_total_capital numeric(14, 2);
  v_allocated numeric(14, 2);
  v_from_deposit numeric(14, 2);
  v_to_deposit numeric(14, 2);
begin
  -- Validar que el monto sea positivo
  if p_amount <= 0 then
    raise exception 'El monto a transferir debe ser mayor a cero' using errcode = '22023';
  end if;

  -- Validar que no se intente transferir de capital a capital
  if p_from_id is null and p_to_id is null then
    raise exception 'No se puede transferir de capital a capital' using errcode = '22023';
  end if;

  -- Validar que origen y destino no sean iguales
  if p_from_id = p_to_id then
    raise exception 'Las cuentas de origen y destino no pueden ser iguales' using errcode = '22023';
  end if;

  -- Caso 1: Desde capital general a cuenta de bróker
  if p_from_id is null then
    select total_capital into v_total_capital
    from public.user_capital
    where user_id = p_user_id;

    if not found then
      raise exception 'El usuario no tiene capital configurado' using errcode = 'P0002';
    end if;

    select coalesce(sum(initial_deposit), 0) into v_allocated
    from public.broker_allocations
    where user_id = p_user_id;

    v_available := v_total_capital - v_allocated;

    if v_available < p_amount then
      raise exception 'Capital disponible insuficiente (disponible: %, requerido: %)', v_available, p_amount using errcode = 'RESER';
    end if;

    -- Verificar que la asignación de destino existe y es del usuario
    select initial_deposit into v_to_deposit
    from public.broker_allocations
    where id = p_to_id and user_id = p_user_id;

    if not found then
      raise exception 'La asignación de destino no existe' using errcode = 'P0002';
    end if;

    update public.broker_allocations
    set initial_deposit = initial_deposit + p_amount
    where id = p_to_id and user_id = p_user_id;

  -- Caso 2: Desde cuenta de bróker a capital general
  elsif p_to_id is null then
    -- Verificar que la asignación de origen existe y es del usuario
    select initial_deposit into v_from_deposit
    from public.broker_allocations
    where id = p_from_id and user_id = p_user_id;

    if not found then
      raise exception 'La asignación de origen no existe' using errcode = 'P0002';
    end if;

    if v_from_deposit < p_amount then
      raise exception 'Saldo insuficiente en la cuenta de origen (disponible: %, requerido: %)', v_from_deposit, p_amount using errcode = 'RESER';
    end if;

    update public.broker_allocations
    set initial_deposit = initial_deposit - p_amount
    where id = p_from_id and user_id = p_user_id;

  -- Caso 3: De cuenta de bróker a cuenta de bróker
  else
    -- Verificar origen
    select initial_deposit into v_from_deposit
    from public.broker_allocations
    where id = p_from_id and user_id = p_user_id;

    if not found then
      raise exception 'La asignación de origen no existe' using errcode = 'P0002';
    end if;

    if v_from_deposit < p_amount then
      raise exception 'Saldo insuficiente en la cuenta de origen (disponible: %, requerido: %)', v_from_deposit, p_amount using errcode = 'RESER';
    end if;

    -- Verificar destino
    select initial_deposit into v_to_deposit
    from public.broker_allocations
    where id = p_to_id and user_id = p_user_id;

    if not found then
      raise exception 'La asignación de destino no existe' using errcode = 'P0002';
    end if;

    update public.broker_allocations
    set initial_deposit = initial_deposit - p_amount
    where id = p_from_id and user_id = p_user_id;

    update public.broker_allocations
    set initial_deposit = initial_deposit + p_amount
    where id = p_to_id and user_id = p_user_id;

  end if;
end;
$$;

-- Otorgar permisos para ejecutar la función
revoke all on function public.transfer_capital(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.transfer_capital(uuid, uuid, uuid, numeric) to service_role;
