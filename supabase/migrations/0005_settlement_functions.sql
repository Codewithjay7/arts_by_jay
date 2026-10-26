-- ============================================================================
-- Arts by Jay — 0005 settlement and refund functions
--
-- These are the only things that turn a payment into a sale. A plpgsql
-- function body runs inside a single transaction, so stock deduction, the
-- order status change and clearing the cart either all happen or none do.
-- ============================================================================

/**
 * Settles a verified payment.
 *
 * Idempotent by design: the guard on `pending_payment` means a replayed
 * webhook and a client-side confirm can both land here and only the first
 * does the work.
 *
 * Called ONLY by Edge Functions holding the service-role key, after the
 * payment has been verified against the gateway. It does not itself verify
 * anything — that is the caller's job, and the caller is trusted server code.
 */
create or replace function public.settle_paid_order(
  p_order_id uuid,
  p_payment_id uuid,
  p_provider_payment_id text default '',
  p_verified_via text default 'webhook',
  p_note text default 'Payment verified.'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status public.order_status;
  item record;
  result public.orders;
  customer uuid;
begin
  -- Lock the order so two concurrent webhooks cannot both settle it.
  select status, customer_id into current_status, customer
  from public.orders
  where id = p_order_id
  for update;

  if current_status is null then
    raise exception 'Order % was not found.', p_order_id using errcode = 'no_data_found';
  end if;

  -- Already settled. Return as-is rather than double-crediting.
  if current_status <> 'pending_payment' then
    select * into result from public.orders where id = p_order_id;
    return result;
  end if;

  -- ── Stock ──
  for item in
    select oi.id, oi.artwork_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    update public.artworks a
    set stock = case
          when a.is_digital_delivery then a.stock
          else greatest(0, a.stock - item.quantity)
        end,
        units_sold = a.units_sold + item.quantity,
        -- A one-of-a-kind piece that has just sold leaves the shop for good.
        status = case
          when not a.is_digital_delivery
               and a.is_unique
               and greatest(0, a.stock - item.quantity) = 0
          then 'unpublished'::public.artwork_status
          else a.status
        end
    where a.id = item.artwork_id;
  end loop;

  -- ── Payment ──
  update public.payments
  set status = 'captured',
      provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
      verified_at = now(),
      verified_via = p_verified_via
  where id = p_payment_id;

  -- ── Order ──
  update public.orders
  set status = 'paid',
      paid_at = now()
  where id = p_order_id
  returning * into result;

  -- ── Cart ──
  delete from public.cart_items
  where cart_id in (select id from public.carts where user_id = customer);

  -- ── Notifications ──
  insert into public.notifications (user_id, type, title, body, link)
  values (
    customer,
    'order_paid',
    format('Order %s confirmed', result.order_number),
    'Thank you. Your order is confirmed and the studio has been notified.',
    format('/account/orders/%s', result.order_number)
  );

  insert into public.notifications (user_id, type, title, body, link)
  select distinct oi.artist_user_id,
         'order_placed',
         format('New sale on order %s', result.order_number),
         'A collector has purchased your work. Please prepare it for dispatch.',
         '/artist/orders'
  from public.order_items oi
  where oi.order_id = p_order_id;

  insert into public.audit_logs (action, entity_type, entity_id, detail)
  values (
    'order.settled', 'order', p_order_id::text,
    jsonb_build_object('verified_via', p_verified_via, 'note', p_note, 'total_minor', result.total_minor)
  );

  return result;
end;
$$;

/**
 * Applies a refund that the GATEWAY has already confirmed.
 *
 * Commission is reversed in proportion to the refund: the platform does not
 * keep a cut of money the customer got back. Gateway fees are generally NOT
 * returned by the provider, so `provider_fee_retained_minor` records that
 * loss rather than hiding it.
 *
 * Settlement is forced back to `on_hold` so a refunded line cannot be paid
 * out to the artist by the eligibility sweep.
 */
create or replace function public.apply_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_provider_refund_id text default '',
  p_reason text default '',
  p_order_item_id uuid default null
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  pay record;
  ord record;
  result public.refunds;
  share numeric;
  commission_back bigint := 0;
  artist_back bigint := 0;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null then
    raise exception 'Payment % was not found.', p_payment_id using errcode = 'no_data_found';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'A refund amount must be positive.' using errcode = 'check_violation';
  end if;

  if pay.refunded_minor + p_amount_minor > pay.amount_minor then
    raise exception
      'That refund (% paise) exceeds what remains of the payment (% paise).',
      p_amount_minor, pay.amount_minor - pay.refunded_minor
      using errcode = 'check_violation';
  end if;

  -- Already recorded under this provider reference: do not double-count.
  if p_provider_refund_id <> '' then
    select * into result from public.refunds where provider_refund_id = p_provider_refund_id;
    if result.id is not null then
      return result;
    end if;
  end if;

  select * into ord from public.orders where id = pay.order_id for update;

  -- Reverse commission in proportion to how much of the order came back.
  share := p_amount_minor::numeric / greatest(1, pay.amount_minor)::numeric;

  select coalesce(round(sum(commission_minor) * share), 0),
         coalesce(round(sum(artist_earnings_minor) * share), 0)
  into commission_back, artist_back
  from public.order_items
  where order_id = ord.id
    and (p_order_item_id is null or id = p_order_item_id);

  insert into public.refunds (
    order_id, order_item_id, payment_id, amount_minor, reason, status,
    provider_refund_id, provider_status,
    commission_reversed_minor, artist_share_reversed_minor
  )
  values (
    ord.id, p_order_item_id, p_payment_id, p_amount_minor, p_reason, 'completed',
    nullif(p_provider_refund_id, ''), 'processed',
    commission_back, artist_back
  )
  returning * into result;

  update public.payments
  set refunded_minor = refunded_minor + p_amount_minor,
      status = case
        when refunded_minor + p_amount_minor >= amount_minor then 'refunded'
        else 'partially_refunded'
      end
  where id = p_payment_id;

  -- Block payout on the affected lines.
  update public.order_items
  set refunded_minor = refunded_minor + (
        case when p_order_item_id is null
             then round(line_total_minor * share)
             else p_amount_minor
        end),
      settlement_status = case
        when settlement_status in ('transferred', 'processing') then settlement_status
        else 'on_hold'
      end,
      settlement_hold_reason = 'A refund has been applied to this item.'
  where order_id = ord.id
    and (p_order_item_id is null or id = p_order_item_id);

  update public.orders
  set status = case
        when pay.refunded_minor + p_amount_minor >= pay.amount_minor then 'refunded'
        else status
      end
  where id = ord.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    ord.customer_id,
    'order_status',
    format('Refund issued for order %s', ord.order_number),
    coalesce(nullif(p_reason, ''), 'Your refund has been sent back to the original payment method.'),
    format('/account/orders/%s', ord.order_number)
  );

  insert into public.audit_logs (action, entity_type, entity_id, detail)
  values (
    'refund.applied', 'refund', result.id::text,
    jsonb_build_object(
      'amount_minor', p_amount_minor,
      'commission_reversed_minor', commission_back,
      'artist_share_reversed_minor', artist_back,
      'order_number', ord.order_number
    )
  );

  return result;
end;
$$;

/**
 * Opens a dispute on a line item, which blocks payout until resolved.
 */
create or replace function public.open_dispute(
  p_order_item_id uuid,
  p_reason text
)
returns public.order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.order_items;
begin
  update public.order_items
  set dispute_open = true,
      dispute_reason = p_reason,
      settlement_status = case
        when settlement_status = 'transferred' then settlement_status
        else 'on_hold'
      end,
      settlement_hold_reason = 'An open dispute must be resolved first.'
  where id = p_order_item_id
  returning * into result;

  if result.id is null then
    raise exception 'Order item % was not found.', p_order_item_id using errcode = 'no_data_found';
  end if;

  update public.orders set status = 'disputed'
  where id = result.order_id and status not in ('refunded', 'cancelled');

  perform public.write_audit('dispute.opened', 'order_item', p_order_item_id::text,
    jsonb_build_object('reason', p_reason));

  return result;
end;
$$;

/**
 * Records that an artist has actually been paid.
 *
 * Deliberately requires evidence. `p_provider_transfer_id` is a real Razorpay
 * Route transfer id; `p_out_of_band_reference` is a bank reference for a
 * manual transfer. One of the two is mandatory, because a payout with no
 * evidence is exactly the fiction this schema exists to prevent.
 */
create or replace function public.record_settlement(
  p_order_item_id uuid,
  p_provider_transfer_id text default '',
  p_out_of_band_reference text default '',
  p_note text default ''
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  account record;
  result public.transfers;
  is_out_of_band boolean := (p_provider_transfer_id = '' and p_out_of_band_reference <> '');
begin
  if p_provider_transfer_id = '' and p_out_of_band_reference = '' then
    raise exception
      'A settlement needs evidence: either a provider transfer id or an out-of-band bank reference.'
      using errcode = 'check_violation';
  end if;

  select * into item from public.order_items where id = p_order_item_id for update;
  if item.id is null then
    raise exception 'Order item % was not found.', p_order_item_id using errcode = 'no_data_found';
  end if;

  if item.settlement_status <> 'eligible' then
    raise exception
      'That item is not eligible for settlement (it is "%"). Delivery must be confirmed, the return window closed, and no dispute or refund open.',
      item.settlement_status
      using errcode = 'check_violation';
  end if;

  select * into account from public.artist_accounts where artist_id = item.artist_id;

  -- A gateway transfer requires an activated linked account. A manual bank
  -- transfer does not, which is what keeps the platform usable without Route.
  if not is_out_of_band then
    if account.id is null or account.status <> 'activated' or not account.payouts_enabled then
      raise exception
        'That artist has no activated linked account, so a gateway transfer cannot be recorded.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.transfers (
    order_item_id, artist_account_id, amount_minor, currency,
    provider_transfer_id, provider_status, idempotency_key,
    settled_at, out_of_band, out_of_band_reference
  )
  values (
    p_order_item_id,
    coalesce(account.id, (select id from public.artist_accounts where artist_id = item.artist_id)),
    item.artist_earnings_minor - item.refunded_minor,
    'INR',
    nullif(p_provider_transfer_id, ''),
    case when is_out_of_band then 'out_of_band' else 'processed' end,
    -- Deterministic, so a retry collides instead of paying twice.
    'settle_' || p_order_item_id::text,
    now(),
    is_out_of_band,
    p_out_of_band_reference
  )
  returning * into result;

  update public.order_items
  set settlement_status = 'transferred'
  where id = p_order_item_id;

  -- The order is settled once every one of its lines is.
  update public.orders o
  set status = 'settled'
  where o.id = item.order_id
    and not exists (
      select 1 from public.order_items oi
      where oi.order_id = o.id and oi.settlement_status <> 'transferred'
    );

  insert into public.notifications (user_id, type, title, body, link)
  values (
    item.artist_user_id,
    'order_status',
    format('Payment sent for "%s"', item.title),
    case
      when is_out_of_band
        then format('Paid by bank transfer, reference %s.', p_out_of_band_reference)
      else 'Your payout has been confirmed by the payment provider.'
    end,
    '/artist/sales'
  );

  perform public.write_audit('settlement.recorded', 'order_item', p_order_item_id::text,
    jsonb_build_object(
      'amount_minor', result.amount_minor,
      'out_of_band', is_out_of_band,
      'reference', coalesce(nullif(p_provider_transfer_id, ''), p_out_of_band_reference),
      'note', p_note
    ));

  return result;
end;
$$;

-- ─────────────────────── Function-level permissions ───────────────────────
-- The money-moving functions are revoked from end users entirely. They are
-- reachable only by the service role inside an Edge Function, so there is no
-- path from a browser to settlement, refunds or payouts.

revoke all on function public.settle_paid_order(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_refund(uuid, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_settlement(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.confirm_delivery(uuid, public.delivery_source, text, text) from public, anon, authenticated;
revoke all on function public.refresh_settlement_eligibility() from public, anon, authenticated;
revoke all on function public.open_dispute(uuid, text) from public, anon, authenticated;

-- Read-only helpers stay available to signed-in users.
grant execute on function public.price_cart(uuid) to authenticated;
grant execute on function public.cart_summary(uuid) to authenticated;
grant execute on function public.artist_payout_summary(uuid) to authenticated;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
