-- El capital del usuario es un DERIVADO: la suma del capital en cada cuenta de bróker.
-- No existe un pool de "capital general / disponible" fuera de los brókers, así que la
-- transferencia solo tiene sentido de una cuenta de bróker a otra. Se reescribe la función
-- para exigir origen y destino (ambos not null) y se eliminan los casos contra el pool.
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
  v_from_deposit numeric(14, 2);
begin
  -- El monto debe ser positivo.
  if p_amount <= 0 then
    raise exception 'El monto a transferir debe ser mayor a cero' using errcode = '22023';
  end if;

  -- Origen y destino son obligatorios: solo se transfiere entre cuentas de bróker.
  if p_from_id is null or p_to_id is null then
    raise exception 'Origen y destino deben ser cuentas de bróker' using errcode = '22023';
  end if;

  -- Origen y destino no pueden ser iguales.
  if p_from_id = p_to_id then
    raise exception 'Las cuentas de origen y destino no pueden ser iguales' using errcode = '22023';
  end if;

  -- Verificar origen (existe, es del usuario y tiene saldo suficiente).
  select initial_deposit into v_from_deposit
  from public.broker_allocations
  where id = p_from_id and user_id = p_user_id;

  if not found then
    raise exception 'La asignación de origen no existe' using errcode = 'P0002';
  end if;

  if v_from_deposit < p_amount then
    raise exception 'Saldo insuficiente en la cuenta de origen (disponible: %, requerido: %)', v_from_deposit, p_amount using errcode = 'RESER';
  end if;

  -- Verificar destino (existe y es del usuario).
  if not exists (
    select 1 from public.broker_allocations
    where id = p_to_id and user_id = p_user_id
  ) then
    raise exception 'La asignación de destino no existe' using errcode = 'P0002';
  end if;

  update public.broker_allocations
  set initial_deposit = initial_deposit - p_amount
  where id = p_from_id and user_id = p_user_id;

  update public.broker_allocations
  set initial_deposit = initial_deposit + p_amount
  where id = p_to_id and user_id = p_user_id;
end;
$$;

-- Los permisos se conservan del migrate original, pero se reafirman por idempotencia.
revoke all on function public.transfer_capital(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.transfer_capital(uuid, uuid, uuid, numeric) to service_role;
