-- ============================================================================
-- Arts by Jay — 0009 customer and admin operations
--
-- RLS deliberately gives a customer no UPDATE on `orders`, because order
-- status is money-adjacent. Cancelling is still a legitimate customer action,
-- so it gets one narrow function that enforces exactly when it is allowed
-- rather than a broad write policy that would allow anything.
--
-- The admin functions here are the same idea: an admin needs to confirm a
-- delivery and move an order along, but should not get blanket write access
-- to settlement columns that `record_settlement` is responsible for.
-- ============================================================================

/**
 * Lets a customer cancel their OWN order, but only before anything ships.
 *
 * Returns whether a refund is now owed. It deliberately does NOT mark
 * anything refunded: money only comes back through the gateway, and
 * `apply_refund` records that once it has.
 */
create or replace function public.cancel_my_order(
  p_order_number text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_shipped integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number and customer_id = auth.uid()
  for update;

  if v_order.id is null then
    raise exception 'That order was not found.' using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('pending_payment', 'paid', 'processing') then
    raise exception
      'This order has already been dispatched and can no longer be cancelled here.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_shipped
  from public.order_items
  where order_id = v_order.id and fulfilment_status in ('shipped', 'delivered');

  if v_shipped > 0 then
    raise exception 'Part of this order has already shipped. Please contact support.'
      using errcode = 'check_violation';
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = coalesce(nullif(p_reason, ''), 'Cancelled by the customer.')
  where id = v_order.id;

  update public.order_items
  set fulfilment_status = 'cancelled',
      settlement_status = 'on_hold',
      settlement_hold_reason = 'The order was cancelled.'
  where order_id = v_order.id;

  -- Tell each artist whose work was in it.
  insert into public.notifications (user_id, type, title, body, link)
  select distinct oi.artist_user_id,
         'order_status',
         format('Order %s was cancelled', v_order.order_number),
         'The collector cancelled this order before dispatch.',
         '/artist/orders'
  from public.order_items oi
  where oi.order_id = v_order.id;

  perform public.write_audit('order.cancelled', 'order', v_order.id::text,
    jsonb_build_object('reason', p_reason, 'was_paid', v_order.paid_at is not null));

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'status', 'cancelled',
    -- A paid order needs a real gateway refund, which an admin issues. We do
    -- not pretend the money is already on its way back.
    'refund_required', v_order.paid_at is not null,
    'refund_note', case
      when v_order.paid_at is not null
        then 'This order was already paid. A refund must be issued by an administrator through the payment gateway.'
      else ''
    end
  );
end;
$$;

/**
 * Admin: confirms delivery and opens the return window.
 *
 * Wraps `confirm_delivery`, which is revoked from browser roles, behind an
 * `is_admin()` check so the dashboard can call it while an artist or customer
 * still cannot.
 */
create or replace function public.admin_confirm_delivery(
  p_order_item_id uuid,
  p_evidence_ref text default '',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can confirm a delivery.'
      using errcode = 'insufficient_privilege';
  end if;

  v_item := public.confirm_delivery(p_order_item_id, 'admin', p_evidence_ref, p_note);

  return jsonb_build_object(
    'id', v_item.id,
    'delivery_confirmed_at', v_item.delivery_confirmed_at,
    'return_window_ends_at', v_item.return_window_ends_at,
    'settlement_status', v_item.settlement_status
  );
end;
$$;

/** Admin: promotes anything whose return window has closed. Safe to re-run. */
create or replace function public.admin_refresh_eligibility()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promoted integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can run the payout sweep.'
      using errcode = 'insufficient_privilege';
  end if;

  v_promoted := public.refresh_settlement_eligibility();

  perform public.write_audit('settlement.sweep', 'order_items', null,
    jsonb_build_object('promoted', v_promoted));

  return jsonb_build_object('promoted', v_promoted);
end;
$$;

/**
 * Admin: records that an artist has been paid.
 *
 * Wraps `record_settlement`, which demands evidence — a provider transfer id
 * or an out-of-band bank reference — and refuses without one. While Razorpay
 * Route is unapproved, the out-of-band path is the only honest option, and it
 * still requires a real bank reference rather than a bare status change.
 */
create or replace function public.admin_record_settlement(
  p_order_item_id uuid,
  p_provider_transfer_id text default '',
  p_out_of_band_reference text default '',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can record a settlement.'
      using errcode = 'insufficient_privilege';
  end if;

  v_transfer := public.record_settlement(
    p_order_item_id, p_provider_transfer_id, p_out_of_band_reference, p_note);

  return jsonb_build_object(
    'id', v_transfer.id,
    'amount_minor', v_transfer.amount_minor,
    'out_of_band', v_transfer.out_of_band,
    'reference', coalesce(nullif(v_transfer.provider_transfer_id, ''), v_transfer.out_of_band_reference),
    'settled_at', v_transfer.settled_at
  );
end;
$$;

/** Admin: opens a dispute, which blocks payout until resolved. */
create or replace function public.admin_open_dispute(
  p_order_item_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can open a dispute.'
      using errcode = 'insufficient_privilege';
  end if;

  v_item := public.open_dispute(p_order_item_id, p_reason);

  return jsonb_build_object(
    'id', v_item.id,
    'dispute_open', v_item.dispute_open,
    'settlement_status', v_item.settlement_status
  );
end;
$$;

/** Admin: resolves a dispute and returns the line to the normal flow. */
create or replace function public.admin_resolve_dispute(
  p_order_item_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can resolve a dispute.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.order_items
  set dispute_open = false,
      dispute_reason = '',
      -- Back to pending, not straight to eligible: the sweep re-checks the
      -- return window and any refund before it becomes payable.
      settlement_status = case
        when settlement_status = 'on_hold' and refunded_minor = 0 then 'pending'
        else settlement_status
      end,
      settlement_hold_reason = case
        when refunded_minor > 0 then 'A refund has been applied to this item.'
        else ''
      end
  where id = p_order_item_id
  returning * into v_item;

  if v_item.id is null then
    raise exception 'Order item % was not found.', p_order_item_id using errcode = 'no_data_found';
  end if;

  update public.orders o
  set status = 'paid'
  where o.id = v_item.order_id
    and o.status = 'disputed'
    and not exists (
      select 1 from public.order_items oi
      where oi.order_id = o.id and oi.dispute_open
    );

  perform public.write_audit('dispute.resolved', 'order_item', p_order_item_id::text,
    jsonb_build_object('resolution', p_resolution));

  return jsonb_build_object('id', v_item.id, 'settlement_status', v_item.settlement_status);
end;
$$;

/**
 * The payout queue: every artist share and where it stands.
 *
 * `is_paid` is true only where the provider (or a recorded bank transfer) has
 * confirmed it. 'eligible' means earned and clear to pay — never paid.
 */
create or replace function public.admin_payout_queue(
  p_status public.settlement_status default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_totals jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can view the payout queue.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_data order by row_data ->> 'created_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', oi.id,
      'title', oi.title,
      'order_number', o.order_number,
      'order_status', o.status,
      'artist_name', ap.display_name,
      'artist_slug', ap.slug,
      'artist_user_id', oi.artist_user_id,
      'line_total_minor', oi.line_total_minor,
      'commission_rate_percent', oi.commission_rate_percent,
      'commission_minor', oi.commission_minor,
      'earnings_minor', oi.artist_earnings_minor,
      'refunded_minor', oi.refunded_minor,
      'fulfilment_status', oi.fulfilment_status,
      'delivery_confirmed_at', oi.delivery_confirmed_at,
      'return_window_ends_at', oi.return_window_ends_at,
      'settlement_status', oi.settlement_status,
      'settlement_hold_reason', oi.settlement_hold_reason,
      'dispute_open', oi.dispute_open,
      'created_at', oi.created_at,
      'is_paid', (t.id is not null and t.settled_at is not null),
      'paid_reference', coalesce(nullif(t.provider_transfer_id, ''), t.out_of_band_reference),
      'paid_out_of_band', t.out_of_band,
      'has_linked_account', (aa.id is not null and aa.status = 'activated' and aa.payouts_enabled)
    ) as row_data
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.artist_profiles ap on ap.id = oi.artist_id
    left join public.transfers t on t.order_item_id = oi.id
    left join public.artist_accounts aa on aa.artist_id = oi.artist_id
    where o.status not in ('pending_payment', 'cancelled')
      and (p_status is null or oi.settlement_status = p_status)
  ) sub;

  select jsonb_build_object(
    'pending_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'pending'), 0),
    'eligible_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'eligible'), 0),
    'on_hold_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'on_hold'), 0),
    'transferred_minor', coalesce(sum(artist_earnings_minor) filter (where settlement_status = 'transferred'), 0),
    'eligible_count', count(*) filter (where settlement_status = 'eligible'),
    'currency', 'INR'
  )
  into v_totals
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status not in ('pending_payment', 'cancelled');

  return jsonb_build_object('items', v_rows, 'totals', v_totals);
end;
$$;

/** Admin: the audit trail, newest first. */
create or replace function public.admin_audit_log(
  p_limit integer default 100,
  p_entity_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can read the audit log.'
      using errcode = 'insufficient_privilege';
  end if;

  return (
    select coalesce(jsonb_agg(entry order by created_at desc), '[]'::jsonb)
    from (
      select al.created_at,
             jsonb_build_object(
               'id', al.id,
               'action', al.action,
               'entity_type', al.entity_type,
               'entity_id', al.entity_id,
               'detail', al.detail,
               'created_at', al.created_at,
               'actor_role', al.actor_role,
               'actor_email', p.email,
               'actor_name', p.full_name
             ) as entry
      from public.audit_logs al
      left join public.profiles p on p.id = al.actor_id
      where p_entity_type is null or al.entity_type = p_entity_type
      order by al.created_at desc
      limit least(500, greatest(1, coalesce(p_limit, 100)))
    ) sub
  );
end;
$$;

-- ── Permissions ──
grant execute on function public.cancel_my_order(text, text) to authenticated;
grant execute on function public.admin_confirm_delivery(uuid, text, text) to authenticated;
grant execute on function public.admin_refresh_eligibility() to authenticated;
grant execute on function public.admin_record_settlement(uuid, text, text, text) to authenticated;
grant execute on function public.admin_open_dispute(uuid, text) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, text) to authenticated;
grant execute on function public.admin_payout_queue(public.settlement_status) to authenticated;
grant execute on function public.admin_audit_log(integer, text) to authenticated;

-- Anonymous callers get none of these. The `admin_*` functions additionally
-- check is_admin() internally, so a merely signed-in user is refused even
-- though execute is granted to the role.
revoke all on function public.cancel_my_order(text, text) from anon;
revoke all on function public.admin_confirm_delivery(uuid, text, text) from anon;
revoke all on function public.admin_refresh_eligibility() from anon;
revoke all on function public.admin_record_settlement(uuid, text, text, text) from anon;
revoke all on function public.admin_open_dispute(uuid, text) from anon;
revoke all on function public.admin_resolve_dispute(uuid, text) from anon;
revoke all on function public.admin_payout_queue(public.settlement_status) from anon;
revoke all on function public.admin_audit_log(integer, text) from anon;
