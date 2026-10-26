-- ============================================================================
-- Arts by Jay — 0011 fix infinite recursion between orders and order_items RLS
--
-- Defect found by querying the live deployment as a seeded customer:
--
--   GET /rest/v1/orders?customer_id=eq.<self>
--   → 42P17  infinite recursion detected in policy for relation "orders"
--
-- So NO customer could read their own order history, and no artist could read
-- an order at all. Order history, the artist sales list and the customer
-- order detail page were all broken — on a table that already holds the
-- financial record of record.
--
-- Cause: a cycle between two permissive SELECT policies.
--
--   orders       "artist reads orders containing their work"
--                  → exists (select 1 from public.order_items ...)
--   order_items  "customer reads own"
--                  → exists (select 1 from public.orders ...)
--
-- Postgres OR-evaluates EVERY permissive policy for the command, not just the
-- one that would let the row through. So a customer reading their own orders
-- still causes the artist policy to run, which selects from order_items,
-- which runs the order_items policies, which select from orders... and the
-- planner detects the loop and aborts the whole statement.
--
-- This is why the bug hid: the policies are individually correct, and each
-- one reads correctly in isolation. Only the pair is wrong. My own
-- verification suite tested the policies' INTENT — that a customer sees only
-- their own orders — using the service role to set up, and never performed a
-- plain authenticated SELECT on `orders`, which is the one thing that fails.
--
-- The blast radius was wider than the two tables: `shipments`, `refunds` and
-- `delivery_confirmations` have policies that select from `orders`, so they
-- entered the same cycle and failed identically.
--
-- Fix: break the cycle with SECURITY DEFINER helpers. A definer function runs
-- as its owner and is not subject to RLS on the tables it reads, so the
-- membership test no longer re-enters the policy system.
--
-- These helpers take NO user-id argument and read `auth.uid()` themselves.
-- That is deliberate: a parameterised `is_member(order_id, user_id)` would be
-- callable directly by any authenticated user to probe whether some OTHER
-- person is on an order. Reading the caller's own identity inside the
-- function makes it impossible to ask the question about anyone else.
--
-- Access granted to the same people as before: a customer still sees only
-- their own orders, an artist only orders containing their own lines.
-- ============================================================================

-- ─────────────────────── Cycle-breaking helpers ───────────────────────

/**
 * True when the calling artist has at least one line on this order.
 *
 * Replaces the inline `exists (select ... from order_items)` that the orders
 * policy used. Reads order_items WITHOUT triggering its policies, which is
 * the entire point.
 */
create or replace function public.order_has_my_artist_line(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.artist_user_id = auth.uid()
  );
$$;

/**
 * True when this order belongs to the calling customer.
 *
 * Replaces the inline `exists (select ... from orders)` that the order_items
 * policy used. Reading `orders` here does not re-enter the orders policies.
 */
create or replace function public.order_is_mine(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.customer_id = auth.uid()
  );
$$;

-- Neither helper is useful to an anonymous caller: auth.uid() is null, so
-- every answer is false. Granting to `authenticated` only keeps the surface
-- as small as the policies need.
revoke all on function public.order_has_my_artist_line(uuid) from public, anon;
revoke all on function public.order_is_mine(uuid) from public, anon;
grant execute on function public.order_has_my_artist_line(uuid) to authenticated;
grant execute on function public.order_is_mine(uuid) to authenticated;

-- ─────────────────────── Rebuild the two policies ───────────────────────
-- Fixing either side alone would break the cycle, but both are replaced:
-- it removes a redundant round of policy evaluation on every read, and it
-- leaves no half of the cycle to be re-formed by a future policy.

drop policy if exists "orders: artist reads orders containing their work" on public.orders;

create policy "orders: artist reads orders containing their work"
  on public.orders for select
  using (public.order_has_my_artist_line(orders.id));

drop policy if exists "order items: customer reads own" on public.order_items;

create policy "order items: customer reads own"
  on public.order_items for select
  using (public.order_is_mine(order_items.order_id));
