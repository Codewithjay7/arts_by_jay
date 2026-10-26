-- ============================================================================
-- Arts by Jay — 0004 pricing, payout eligibility, storage
--
-- The price of a cart and the commission on it are computed HERE, in the
-- database, from the current listings. The browser never supplies an amount.
-- ============================================================================

-- ───────────────────────── Cart pricing ─────────────────────────
-- Re-prices a cart from scratch and reports anything that changed since the
-- customer added it, so they are told rather than silently charged.

create type public.priced_line as (
  artwork_id uuid,
  artist_id uuid,
  artist_user_id uuid,
  title text,
  quantity integer,
  unit_price_minor bigint,
  line_total_minor bigint,
  shipping_minor bigint,
  commission_rate_percent numeric,
  commission_basis_minor bigint,
  commission_minor bigint,
  artist_earnings_minor bigint,
  is_digital boolean,
  issue_kind text,
  issue_message text
);

create or replace function public.price_cart(p_user_id uuid)
returns setof public.priced_line
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rate numeric := public.setting_int('commission_percent', 10);
  item record;
  effective_qty integer;
  digital boolean;
  issue_kind text;
  issue_message text;
  basis bigint;
  commission bigint;
  ship bigint;
begin
  for item in
    select ci.artwork_id,
           ci.quantity,
           ci.price_at_add_minor,
           a.title,
           a.artist_id,
           a.owner_id,
           a.price_minor,
           a.stock,
           a.allow_backorder,
           a.is_unique,
           a.is_digital_delivery,
           a.shipping_flat_minor,
           a.status,
           a.type
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.artworks a on a.id = ci.artwork_id
    where c.user_id = p_user_id
  loop
    digital := item.is_digital_delivery;
    issue_kind := null;
    issue_message := null;

    -- ── Lines that cannot be bought: reported, but not priced ──
    -- Each row is returned by a single ROW() construction. Assigning field by
    -- field onto a composite variable that is still NULL fails at runtime in
    -- plpgsql, so the whole row is always built in one go.

    if item.status <> 'published' then
      return next row(
        item.artwork_id, item.artist_id, item.owner_id, item.title,
        null::integer, null::bigint, null::bigint, null::bigint,
        null::numeric, null::bigint, null::bigint, null::bigint,
        digital, 'unavailable',
        format('"%s" is no longer on sale.', item.title)
      )::public.priced_line;
      continue;
    end if;

    if item.type = 'commission' then
      return next row(
        item.artwork_id, item.artist_id, item.owner_id, item.title,
        null::integer, null::bigint, null::bigint, null::bigint,
        null::numeric, null::bigint, null::bigint, null::bigint,
        digital, 'commission_only',
        format('"%s" is a commission and is arranged with the artist rather than bought directly.', item.title)
      )::public.priced_line;
      continue;
    end if;

    effective_qty := item.quantity;

    if not digital and not item.allow_backorder then
      if item.stock <= 0 then
        return next row(
          item.artwork_id, item.artist_id, item.owner_id, item.title,
          null::integer, null::bigint, null::bigint, null::bigint,
          null::numeric, null::bigint, null::bigint, null::bigint,
          digital, 'sold_out',
          format('"%s" has sold out.', item.title)
        )::public.priced_line;
        continue;
      end if;

      if effective_qty > item.stock then
        effective_qty := item.stock;
        issue_kind := 'quantity_reduced';
        issue_message := format(
          'Only %s of "%s" remain, so the quantity was reduced.', item.stock, item.title);
      end if;
    end if;

    -- An original is one of one.
    if item.is_unique then
      effective_qty := 1;
    end if;

    if item.price_at_add_minor <> item.price_minor and issue_kind is null then
      issue_kind := 'price_changed';
      issue_message := format('The price of "%s" changed since you added it.', item.title);
    end if;

    -- Commission applies to the artwork line total only, NEVER to shipping.
    basis := item.price_minor::bigint * effective_qty;
    -- Integer paise throughout: round once, then derive the remainder, so the
    -- two halves always sum back to the basis exactly.
    commission := round(basis * rate / 100.0)::bigint;
    ship := case when digital then 0::bigint else item.shipping_flat_minor end;

    return next row(
      item.artwork_id, item.artist_id, item.owner_id, item.title,
      effective_qty, item.price_minor::bigint, basis, ship,
      rate, basis, commission, basis - commission,
      digital, issue_kind, issue_message
    )::public.priced_line;
  end loop;
end;
$$;

-- A compact summary for the cart and checkout screens.
create or replace function public.cart_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lines as (select * from public.price_cart(p_user_id))
  select jsonb_build_object(
    'subtotal_minor', coalesce(sum(line_total_minor) filter (where issue_kind is distinct from 'unavailable'
                        and issue_kind is distinct from 'sold_out'
                        and issue_kind is distinct from 'commission_only'), 0),
    'shipping_total_minor', coalesce(sum(shipping_minor) filter (where line_total_minor is not null), 0),
    'commission_minor', coalesce(sum(commission_minor), 0),
    'artist_earnings_minor', coalesce(sum(artist_earnings_minor), 0),
    'item_count', coalesce(sum(quantity), 0),
    'currency', 'INR',
    'issues', coalesce(
      jsonb_agg(jsonb_build_object('artwork_id', artwork_id, 'kind', issue_kind, 'message', issue_message))
        filter (where issue_kind is not null),
      '[]'::jsonb),
    'can_proceed', not bool_or(issue_kind in ('unavailable', 'sold_out', 'commission_only'))
                   and count(*) filter (where line_total_minor is not null) > 0
  )
  from lines;
$$;

-- ───────────────────── Order number generation ─────────────────────

create or replace function public.generate_order_number()
returns text
language sql
volatile
as $$
  select 'ABJ-'
    || upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint))
    || '-'
    || upper(encode(extensions.gen_random_bytes(2), 'hex'));
$$;

-- ═══════════════════════ Payout eligibility ═══════════════════════
--
-- IMPORTANT, AND DELIBERATE:
--
-- These functions decide when an artist has EARNED their share. They do not
-- move money and they are not an escrow. Real funds sit with the payment
-- gateway under its own settlement schedule, and no row in this database can
-- change that.
--
-- Turning an 'eligible' row into money in an artist's bank account requires
-- either (a) Razorpay Route, which must be approved on the account, or
-- (b) a manual bank transfer recorded against `transfers.out_of_band`.
--
-- Until one of those happens, nothing here should be presented to an artist
-- as "paid".

/**
 * Opens the return window once delivery is confirmed. Service-role only in
 * practice, because RLS gives no user write access to these columns.
 */
create or replace function public.confirm_delivery(
  p_order_item_id uuid,
  p_source public.delivery_source,
  p_evidence_ref text default '',
  p_note text default ''
)
returns public.order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  window_days integer := public.setting_int('return_window_days', 7);
  updated public.order_items;
begin
  update public.order_items
  set delivery_confirmed_at = coalesce(delivery_confirmed_at, now()),
      delivery_confirmed_via = p_source,
      delivery_confirmed_by = auth.uid(),
      delivery_evidence_ref = coalesce(nullif(p_evidence_ref, ''), delivery_evidence_ref),
      return_window_days = window_days,
      return_window_ends_at = coalesce(delivery_confirmed_at, now()) + (window_days || ' days')::interval,
      fulfilment_status = 'delivered',
      delivered_at = coalesce(delivered_at, now())
  where id = p_order_item_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Order item % was not found.', p_order_item_id using errcode = 'no_data_found';
  end if;

  insert into public.delivery_confirmations
    (order_item_id, source, confirmed_by, evidence_ref, note)
  values
    (p_order_item_id, p_source, auth.uid(), p_evidence_ref, p_note);

  perform public.write_audit(
    'delivery.confirmed', 'order_item', p_order_item_id::text,
    jsonb_build_object('source', p_source, 'return_window_days', window_days)
  );

  return updated;
end;
$$;

/**
 * Promotes line items to 'eligible' once:
 *   - delivery is confirmed,
 *   - the return window has closed,
 *   - there is no open dispute,
 *   - nothing has been refunded,
 *   - and the payment is actually captured and verified.
 *
 * Safe to run repeatedly; it only ever moves 'pending' rows forward.
 */
create or replace function public.refresh_settlement_eligibility()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with promoted as (
    update public.order_items oi
    set settlement_status = 'eligible',
        became_eligible_at = now(),
        settlement_hold_reason = ''
    where oi.settlement_status = 'pending'
      and oi.delivery_confirmed_at is not null
      and oi.return_window_ends_at is not null
      and oi.return_window_ends_at <= now()
      and oi.dispute_open = false
      and oi.refunded_minor = 0
      and oi.fulfilment_status = 'delivered'
      and exists (
        select 1
        from public.orders o
        join public.payments p on p.order_id = o.id
        where o.id = oi.order_id
          and p.status = 'captured'
          and p.verified_at is not null
      )
    returning oi.id
  )
  select count(*) into affected from promoted;

  -- Anything under dispute or partially refunded goes on hold instead.
  update public.order_items
  set settlement_status = 'on_hold',
      settlement_hold_reason = case
        when dispute_open then 'An open dispute must be resolved first.'
        else 'A refund has been applied to this item.'
      end
  where settlement_status in ('pending', 'eligible')
    and (dispute_open = true or refunded_minor > 0);

  return affected;
end;
$$;

/** What an artist is owed, split by settlement state. Honest labelling. */
create or replace function public.artist_payout_summary(p_artist_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'currency', 'INR',
    'commission_percent', public.setting_int('commission_percent', 10),
    'return_window_days', public.setting_int('return_window_days', 7),
    'gross_minor', coalesce(sum(line_total_minor), 0),
    'commission_minor', coalesce(sum(commission_minor), 0),
    'earnings_minor', coalesce(sum(artist_earnings_minor), 0),
    -- Earned but the window is still open, or delivery is unconfirmed.
    'pending_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'pending'), 0),
    -- Earned and clear to pay, but NOT yet paid.
    'eligible_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'eligible'), 0),
    'on_hold_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'on_hold'), 0),
    -- Confirmed by the provider as actually transferred.
    'transferred_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'transferred'), 0),
    'units_sold', coalesce(sum(quantity), 0)
  )
  from public.order_items oi
  where oi.artist_user_id = p_artist_user_id
    and exists (
      select 1 from public.orders o
      where o.id = oi.order_id
        and o.status not in ('pending_payment', 'cancelled')
    );
$$;

-- ═══════════════════════════ Storage ═══════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('artworks', 'artworks', true, 8388608,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('avatars', 'avatars', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  -- Private: these are customers' own photographs, uploaded for a commission.
  ('commission-references', 'commission-references', false, 8388608,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

/**
 * Upload paths are namespaced by user id as the FIRST folder segment, and the
 * policies below require that segment to equal auth.uid(). That is what stops
 * one artist writing into another's folder.
 *
 *   artworks/<user_id>/<artwork_id>/<file>
 *   avatars/<user_id>/<file>
 *   commission-references/<user_id>/<file>
 */

create policy "artworks: public read"
  on storage.objects for select
  using (bucket_id = 'artworks');

create policy "artworks: approved artist writes own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.artist_profiles ap
      where ap.user_id = auth.uid() and ap.status = 'approved'
    )
  );

create policy "artworks: artist updates own folder"
  on storage.objects for update
  using (bucket_id = 'artworks' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "artworks: artist deletes own folder"
  on storage.objects for delete
  using (bucket_id = 'artworks' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: user writes own folder"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: user replaces own"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: user deletes own"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- A customer's private photograph: readable by the uploader, and by the
-- artist handling the commission it is attached to. Nobody else.
create policy "references: uploader reads own"
  on storage.objects for select
  using (
    bucket_id = 'commission-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "references: assigned artist reads"
  on storage.objects for select
  using (
    bucket_id = 'commission-references'
    and exists (
      select 1 from public.commission_requests cr
      where cr.artist_user_id = auth.uid()
        and cr.photo_consent = true
        and cr.reference_images::text like '%' || storage.objects.name || '%'
    )
  );

create policy "references: uploader writes own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'commission-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "references: uploader deletes own"
  on storage.objects for delete
  using (
    bucket_id = 'commission-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
