-- ============================================================================
-- Arts by Jay — 0010 fix cart_summary.can_proceed
--
-- Defect found by testing the live deployment: `can_proceed` came back NULL
-- for a perfectly healthy cart, and the client uses it to enable the checkout
-- button — so a customer with nothing wrong would have found checkout
-- disabled.
--
-- Cause: `bool_or(x) FILTER (WHERE ...)` over zero matching rows returns NULL,
-- not false. `not NULL` is NULL, and `NULL and true` is NULL. A cart with NO
-- issues is exactly the case with zero matching rows, so the healthy path was
-- the broken one.
--
-- Fixed by coalescing each aggregate before combining them. The same class of
-- bug is why `issues` was already wrapped in coalesce.
-- ============================================================================

create or replace function public.cart_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lines as (select * from public.price_cart(p_user_id))
  select jsonb_build_object(
    'subtotal_minor', coalesce(sum(line_total_minor), 0),
    'shipping_total_minor', coalesce(sum(shipping_minor), 0),
    'commission_minor', coalesce(sum(commission_minor), 0),
    'artist_earnings_minor', coalesce(sum(artist_earnings_minor), 0),
    'item_count', coalesce(sum(quantity), 0),
    'currency', 'INR',
    'issues', coalesce(
      jsonb_agg(jsonb_build_object('artwork_id', artwork_id, 'kind', issue_kind, 'message', issue_message))
        filter (where issue_kind is not null),
      '[]'::jsonb),
    -- Proceed when at least one line is priceable and nothing is blocking.
    -- Both aggregates are coalesced: over zero matching rows bool_or returns
    -- NULL, which would poison the whole expression.
    'can_proceed',
      coalesce(count(*) filter (where line_total_minor is not null), 0) > 0
      and not coalesce(
        bool_or(issue_kind in ('unavailable', 'sold_out', 'commission_only')),
        false
      )
  )
  from lines;
$$;

grant execute on function public.cart_summary(uuid) to authenticated;
