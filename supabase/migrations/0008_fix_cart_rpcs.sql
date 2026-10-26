-- ============================================================================
-- Arts by Jay — 0008 fix the cart RPCs
--
-- Defect found by live verification: add_to_cart and set_cart_quantity
-- referred to a local variable as `add_to_cart.cart_id`, qualifying it with
-- the function name to disambiguate it from the `cart_items.cart_id` column.
-- PL/pgSQL read that qualifier as a table reference and failed at runtime
-- with "missing FROM-clause entry for table add_to_cart".
--
-- Rewritten with `v_`-prefixed locals so no local can ever collide with a
-- column name. That removes the need to qualify anything, and with it the
-- whole class of bug.
-- ============================================================================

create or replace function public.add_to_cart(
  p_artwork_id uuid,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cart uuid;
  v_existing integer := 0;
  v_desired integer;
  v_art record;
begin
  if v_user is null then
    raise exception 'Please sign in to use your cart.' using errcode = 'insufficient_privilege';
  end if;

  select id, title, type, status, stock, allow_backorder, is_unique,
         is_digital_delivery, price_minor
  into v_art
  from public.artworks
  where id = p_artwork_id;

  if v_art.id is null or v_art.status <> 'published' then
    raise exception 'That artwork is not available.' using errcode = 'no_data_found';
  end if;

  if v_art.type = 'commission' then
    raise exception 'Commissions are arranged with the artist rather than added to the cart.'
      using errcode = 'check_violation';
  end if;

  if not v_art.is_digital_delivery and not v_art.allow_backorder and v_art.stock <= 0 then
    raise exception 'That piece has sold out.' using errcode = 'check_violation';
  end if;

  select id into v_cart from public.carts where user_id = v_user;
  if v_cart is null then
    insert into public.carts (user_id) values (v_user) returning id into v_cart;
  end if;

  select quantity into v_existing
  from public.cart_items
  where cart_id = v_cart and artwork_id = p_artwork_id;

  v_desired := coalesce(v_existing, 0) + greatest(1, coalesce(p_quantity, 1));

  -- The requested quantity is a request, not an instruction.
  if not v_art.is_digital_delivery and not v_art.allow_backorder then
    v_desired := least(v_desired, v_art.stock);
  end if;
  -- An original is one of one, whatever was asked for.
  if v_art.is_unique then
    v_desired := 1;
  end if;
  v_desired := least(v_desired, 50);

  insert into public.cart_items (cart_id, artwork_id, quantity, price_at_add_minor)
  values (v_cart, p_artwork_id, v_desired, v_art.price_minor)
  on conflict (cart_id, artwork_id)
  do update set quantity = v_desired, price_at_add_minor = v_art.price_minor;

  return public.cart_summary(v_user);
end;
$$;

create or replace function public.set_cart_quantity(
  p_artwork_id uuid,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cart uuid;
  v_desired integer;
  v_art record;
begin
  if v_user is null then
    raise exception 'Please sign in to use your cart.' using errcode = 'insufficient_privilege';
  end if;

  select id into v_cart from public.carts where user_id = v_user;
  if v_cart is null then
    return public.cart_summary(v_user);
  end if;

  if p_quantity <= 0 then
    delete from public.cart_items where cart_id = v_cart and artwork_id = p_artwork_id;
    return public.cart_summary(v_user);
  end if;

  select stock, allow_backorder, is_unique, is_digital_delivery
  into v_art
  from public.artworks
  where id = p_artwork_id;

  v_desired := least(greatest(1, p_quantity), 50);

  if v_art.is_unique then
    v_desired := 1;
  elsif not v_art.is_digital_delivery and not v_art.allow_backorder then
    v_desired := least(v_desired, greatest(0, v_art.stock));
  end if;

  if v_desired <= 0 then
    delete from public.cart_items where cart_id = v_cart and artwork_id = p_artwork_id;
  else
    update public.cart_items
    set quantity = v_desired
    where cart_id = v_cart and artwork_id = p_artwork_id;
  end if;

  return public.cart_summary(v_user);
end;
$$;

-- `create or replace` keeps existing grants, but re-stating them makes the
-- intent explicit and survives a future signature change.
grant execute on function public.add_to_cart(uuid, integer) to authenticated;
grant execute on function public.set_cart_quantity(uuid, integer) to authenticated;
revoke all on function public.add_to_cart(uuid, integer) from anon;
revoke all on function public.set_cart_quantity(uuid, integer) from anon;
