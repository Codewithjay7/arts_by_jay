-- ============================================================================
-- Arts by Jay — 0006 client-facing RPCs
--
-- Operations the browser is allowed to perform, but which involve a decision
-- that must not be made client-side. Putting them here means the rule lives
-- in one place and cannot be bypassed by a crafted request.
-- ============================================================================

/**
 * Advisory view counter.
 *
 * Deliberately not a plain UPDATE from the client: that would need a write
 * policy on `artworks`, which would then also let a visitor change any other
 * column they liked. A narrow SECURITY DEFINER function grants exactly one
 * capability and nothing else.
 */
create or replace function public.increment_artwork_views(p_artwork_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.artworks
  set views = views + 1
  where id = p_artwork_id and status = 'published';
$$;

/**
 * Adds an item to the caller's cart, applying the availability rules.
 *
 * The quantity the caller asks for is a request, not an instruction: an
 * original is forced to one, stock caps the rest, and a sold-out or
 * commission-only piece is refused outright. Returning the cart summary saves
 * the client a second round trip.
 */
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
  art record;
  cart_id uuid;
  existing integer := 0;
  desired integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to use your cart.' using errcode = 'insufficient_privilege';
  end if;

  select id, title, type, status, stock, allow_backorder, is_unique,
         is_digital_delivery, price_minor
  into art
  from public.artworks
  where id = p_artwork_id;

  if art.id is null or art.status <> 'published' then
    raise exception 'That artwork is not available.' using errcode = 'no_data_found';
  end if;

  if art.type = 'commission' then
    raise exception 'Commissions are arranged with the artist rather than added to the cart.'
      using errcode = 'check_violation';
  end if;

  if not art.is_digital_delivery and not art.allow_backorder and art.stock <= 0 then
    raise exception 'That piece has sold out.' using errcode = 'check_violation';
  end if;

  select c.id into cart_id from public.carts c where c.user_id = auth.uid();
  if cart_id is null then
    insert into public.carts (user_id) values (auth.uid()) returning id into cart_id;
  end if;

  select quantity into existing
  from public.cart_items
  where cart_items.cart_id = add_to_cart.cart_id and artwork_id = p_artwork_id;

  desired := coalesce(existing, 0) + greatest(1, coalesce(p_quantity, 1));

  if not art.is_digital_delivery and not art.allow_backorder then
    desired := least(desired, art.stock);
  end if;
  -- An original is one of one, whatever was asked for.
  if art.is_unique then
    desired := 1;
  end if;
  desired := least(desired, 50);

  insert into public.cart_items (cart_id, artwork_id, quantity, price_at_add_minor)
  values (cart_id, p_artwork_id, desired, art.price_minor)
  on conflict (cart_id, artwork_id)
  do update set quantity = desired, price_at_add_minor = art.price_minor;

  return public.cart_summary(auth.uid());
end;
$$;

/** Sets a cart quantity, or removes the line when it reaches zero. */
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
  art record;
  cart_id uuid;
  desired integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to use your cart.' using errcode = 'insufficient_privilege';
  end if;

  select c.id into cart_id from public.carts c where c.user_id = auth.uid();
  if cart_id is null then
    return public.cart_summary(auth.uid());
  end if;

  if p_quantity <= 0 then
    delete from public.cart_items
    where cart_items.cart_id = set_cart_quantity.cart_id and artwork_id = p_artwork_id;
    return public.cart_summary(auth.uid());
  end if;

  select stock, allow_backorder, is_unique, is_digital_delivery
  into art
  from public.artworks
  where id = p_artwork_id;

  desired := least(greatest(1, p_quantity), 50);
  if art.is_unique then
    desired := 1;
  elsif not art.is_digital_delivery and not art.allow_backorder then
    desired := least(desired, greatest(0, art.stock));
  end if;

  if desired <= 0 then
    delete from public.cart_items
    where cart_items.cart_id = set_cart_quantity.cart_id and artwork_id = p_artwork_id;
  else
    update public.cart_items
    set quantity = desired
    where cart_items.cart_id = set_cart_quantity.cart_id and artwork_id = p_artwork_id;
  end if;

  return public.cart_summary(auth.uid());
end;
$$;

/** Toggles a wishlist entry and keeps the artwork's counter in step. */
create or replace function public.toggle_wishlist(p_artwork_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to save work.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.artworks where id = p_artwork_id and status = 'published') then
    raise exception 'That artwork is not available.' using errcode = 'no_data_found';
  end if;

  with deleted as (
    delete from public.wishlist_items
    where user_id = auth.uid() and artwork_id = p_artwork_id
    returning 1
  )
  select count(*) into removed from deleted;

  if removed = 0 then
    insert into public.wishlist_items (user_id, artwork_id)
    values (auth.uid(), p_artwork_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'added', removed = 0,
    'total', (select count(*) from public.wishlist_items where user_id = auth.uid())
  );
end;
$$;

/**
 * The gallery wall layout.
 *
 * Computed here so the 3D client, the 2D fallback and any future client all
 * agree on where each piece hangs, and so a room and slot can be deep-linked.
 * Mirrors the geometry in client/src/gallery/galleryConstants.js.
 */
create or replace function public.gallery_layout(p_limit integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  slots_per_room constant integer := 6;
  spacing constant numeric := 7;
  room_length constant numeric := (slots_per_room / 2) * spacing;
  wall_x constant numeric := 5.85;
  art_y constant numeric := 2.3;
  items jsonb := '[]'::jsonb;
  row_data record;
  idx integer := 0;
  room integer;
  slot integer;
  side text;
  depth_index integer;
  z numeric;
begin
  for row_data in
    select a.id, a.title, a.slug, a.price_minor, a.compare_at_price_minor, a.currency,
           a.images, a.type, a.medium, a.style, a.orientation,
           a.width_cm, a.height_cm, a.depth_cm,
           a.stock, a.allow_backorder, a.is_digital_delivery, a.is_unique,
           a.is_featured, a.rating_average, a.rating_count,
           ap.id as artist_id, ap.display_name, ap.slug as artist_slug
    from public.artworks a
    join public.artist_profiles ap on ap.id = a.artist_id
    where a.status = 'published'
      and a.in_virtual_gallery
      and jsonb_array_length(a.images) > 0
    order by a.is_featured desc, a.published_at desc nulls last
    limit greatest(slots_per_room, least(48, coalesce(p_limit, 24)))
  loop
    room := idx / slots_per_room;
    slot := idx % slots_per_room;
    side := case when slot % 2 = 0 then 'left' else 'right' end;
    depth_index := slot / 2;
    -- Depth grows through the whole corridor, not per room, so scroll
    -- progress maps onto one continuous forward axis.
    z := -(room * room_length + depth_index * spacing + spacing);

    items := items || jsonb_build_array(jsonb_build_object(
      'id', row_data.id,
      'title', row_data.title,
      'slug', row_data.slug,
      'priceMinor', row_data.price_minor,
      'compareAtPriceMinor', row_data.compare_at_price_minor,
      'currency', row_data.currency,
      'image', case
        when jsonb_array_length(row_data.images) > 0
        then jsonb_build_object(
          'url', row_data.images -> 0 ->> 'url',
          'thumbUrl', coalesce(row_data.images -> 0 ->> 'thumbUrl', row_data.images -> 0 ->> 'url'),
          'alt', coalesce(row_data.images -> 0 ->> 'alt', row_data.title))
        else null
      end,
      'type', row_data.type,
      'medium', row_data.medium,
      'style', row_data.style,
      'orientation', row_data.orientation,
      'dimensions', jsonb_build_object(
        'width', row_data.width_cm, 'height', row_data.height_cm,
        'depth', row_data.depth_cm, 'unit', 'cm'),
      'stock', row_data.stock,
      'isSoldOut', (not row_data.is_digital_delivery
                    and not row_data.allow_backorder
                    and row_data.stock <= 0),
      'isPurchasable', (row_data.type <> 'commission'
                        and (row_data.is_digital_delivery
                             or row_data.allow_backorder
                             or row_data.stock > 0)),
      'isFeatured', row_data.is_featured,
      'rating', jsonb_build_object('average', row_data.rating_average, 'count', row_data.rating_count),
      'artist', jsonb_build_object(
        'id', row_data.artist_id, 'displayName', row_data.display_name, 'slug', row_data.artist_slug),
      'gallery', jsonb_build_object(
        'index', idx,
        'room', room,
        'roomLabel', 'Room ' || lpad((room + 1)::text, 2, '0'),
        'slot', slot,
        'side', side,
        'position', jsonb_build_array(
          case when side = 'left' then -wall_x else wall_x end, art_y, z),
        'rotationY', case when side = 'left' then pi() / 2 else -pi() / 2 end,
        'viewpoint', jsonb_build_array(
          case when side = 'left' then -1.9 else 1.9 end, art_y - 0.35, z)
      )
    ));

    idx := idx + 1;
  end loop;

  return jsonb_build_object(
    'artworks', items,
    'total', idx,
    'layout', jsonb_build_object(
      'slotsPerRoom', slots_per_room,
      'totalRooms', greatest(1, ceil(idx::numeric / slots_per_room)::integer),
      'corridorLength', case when idx = 0 then spacing * 3
                        else abs(-(((idx - 1) / slots_per_room) * room_length
                             + (((idx - 1) % slots_per_room) / 2) * spacing + spacing)) + spacing * 2
                        end
    ),
    'rooms', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'room', r,
               'label', 'Room ' || lpad((r + 1)::text, 2, '0'),
               'count', least(slots_per_room, idx - r * slots_per_room))
             order by r), '[]'::jsonb)
      from generate_series(0, greatest(0, ceil(idx::numeric / slots_per_room)::integer - 1)) as r
      where idx > 0
    )
  );
end;
$$;

-- ── Permissions ──
-- These are the only write-ish capabilities a browser gets, and each one is
-- narrow by construction.

grant execute on function public.increment_artwork_views(uuid) to anon, authenticated;
grant execute on function public.gallery_layout(integer) to anon, authenticated;
grant execute on function public.add_to_cart(uuid, integer) to authenticated;
grant execute on function public.set_cart_quantity(uuid, integer) to authenticated;
grant execute on function public.toggle_wishlist(uuid) to authenticated;

revoke all on function public.add_to_cart(uuid, integer) from anon;
revoke all on function public.set_cart_quantity(uuid, integer) from anon;
revoke all on function public.toggle_wishlist(uuid) from anon;
