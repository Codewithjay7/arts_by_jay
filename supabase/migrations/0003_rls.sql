-- ============================================================================
-- Arts by Jay — 0003 Row Level Security
--
-- Enabling RLS with no matching policy denies everything, so each table is
-- locked down first and then opened only where it must be.
--
-- The rules this file enforces:
--   * a customer reaches only their own private data
--   * an artist manages only their own listings and sees only their own
--     order lines, even inside an order shared with other artists
--   * money tables (payments, transfers, refunds, settlements) are
--     READ-ONLY to everyone except the service role
--   * nobody can change their own role
--   * audit logs and webhook events are append-only
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.artist_profiles     enable row level security;
alter table public.artist_accounts     enable row level security;
alter table public.categories          enable row level security;
alter table public.artworks            enable row level security;
alter table public.carts               enable row level security;
alter table public.cart_items          enable row level security;
alter table public.wishlist_items      enable row level security;
alter table public.addresses           enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.payments            enable row level security;
alter table public.webhook_events      enable row level security;
alter table public.shipments           enable row level security;
alter table public.delivery_confirmations enable row level security;
alter table public.refunds             enable row level security;
alter table public.transfers           enable row level security;
alter table public.settlements         enable row level security;
alter table public.reviews             enable row level security;
alter table public.commission_requests enable row level security;
alter table public.notifications       enable row level security;

-- Force RLS even for the table owner, so a mistake elsewhere cannot bypass it.
alter table public.payments    force row level security;
alter table public.transfers   force row level security;
alter table public.refunds     force row level security;
alter table public.settlements force row level security;

-- ─────────────────────────────── Profiles ───────────────────────────────

create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: read any as admin"
  on public.profiles for select
  using (public.is_admin());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admin manages all"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

/**
 * Role escalation guard.
 *
 * The "update own" policy above cannot express "every column except role", so
 * a trigger enforces it. Only an admin may change a role or reactivate a
 * suspended account, and an admin cannot demote or suspend themselves.
 */
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (no auth.uid()) is trusted; it is server-side only.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role.' using errcode = 'insufficient_privilege';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'You cannot change your own account status.' using errcode = 'insufficient_privilege';
    end if;
    if new.suspended_reason is distinct from old.suspended_reason then
      raise exception 'You cannot change your own suspension reason.' using errcode = 'insufficient_privilege';
    end if;
  elsif new.id = auth.uid()
        and (new.role <> 'admin' or new.is_active = false) then
    raise exception 'An administrator cannot demote or suspend their own account.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

-- ──────────────────────── Platform settings ────────────────────────
-- The commission rate and return window must be readable so the UI can state
-- them. The admin bootstrap email must not be.

create policy "settings: read non-sensitive"
  on public.platform_settings for select
  using (key in ('commission_percent', 'return_window_days', 'razorpay_route_enabled'));

create policy "settings: admin reads all"
  on public.platform_settings for select
  using (public.is_admin());

create policy "settings: admin writes"
  on public.platform_settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- ─────────────────────────────── Audit logs ───────────────────────────────
-- Append-only: insert and select, never update or delete.

create policy "audit: admin reads"
  on public.audit_logs for select
  using (public.is_admin());

create policy "audit: actor reads own"
  on public.audit_logs for select
  using (actor_id = auth.uid());

create policy "audit: authenticated appends"
  on public.audit_logs for insert
  with check (auth.uid() is not null and actor_id = auth.uid());

-- ───────────────────────── Artist profiles ─────────────────────────

create policy "artists: public reads approved"
  on public.artist_profiles for select
  using (status = 'approved');

create policy "artists: read own at any status"
  on public.artist_profiles for select
  using (user_id = auth.uid());

create policy "artists: admin reads all"
  on public.artist_profiles for select
  using (public.is_admin());

create policy "artists: create own"
  on public.artist_profiles for insert
  with check (user_id = auth.uid());

create policy "artists: update own"
  on public.artist_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "artists: admin manages all"
  on public.artist_profiles for all
  using (public.is_admin())
  with check (public.is_admin());

/** An artist must not approve themselves, nor edit their own earnings. */
create or replace function public.artist_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'Only an administrator can change an artist approval status.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.is_featured is distinct from old.is_featured
     or new.review_note is distinct from old.review_note
     or new.reviewed_by is distinct from old.reviewed_by then
    raise exception 'That field is managed by the marketplace, not the artist.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger artist_profiles_guard_trigger
  before update on public.artist_profiles
  for each row execute function public.artist_profiles_guard();

-- ───────────────────────── Linked accounts ─────────────────────────
-- Readable by the artist, but NEVER writable by them: changing
-- provider_account_id would redirect someone else's money.

create policy "artist accounts: read own"
  on public.artist_accounts for select
  using (user_id = auth.uid());

create policy "artist accounts: admin reads all"
  on public.artist_accounts for select
  using (public.is_admin());

-- No insert/update/delete policy for end users at all. Onboarding is driven
-- exclusively by the Edge Function running as the service role.

-- ───────────────────────────── Categories ─────────────────────────────

create policy "categories: public reads"
  on public.categories for select
  using (true);

create policy "categories: admin writes"
  on public.categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- ───────────────────────────── Artworks ─────────────────────────────

create policy "artworks: public reads published"
  on public.artworks for select
  using (status = 'published');

create policy "artworks: owner reads own"
  on public.artworks for select
  using (owner_id = auth.uid());

create policy "artworks: admin reads all"
  on public.artworks for select
  using (public.is_admin());

/**
 * An artist may only create a listing against their OWN artist profile, and
 * only once approved. The status is forced to 'draft' by the guard below.
 */
create policy "artworks: approved artist creates own"
  on public.artworks for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.artist_profiles ap
      where ap.id = artworks.artist_id
        and ap.user_id = auth.uid()
        and ap.status = 'approved'
    )
  );

create policy "artworks: owner updates own"
  on public.artworks for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "artworks: owner deletes own"
  on public.artworks for delete
  using (owner_id = auth.uid());

create policy "artworks: admin manages all"
  on public.artworks for all
  using (public.is_admin())
  with check (public.is_admin());

/**
 * Publication guard.
 *
 * An artist may move a listing between draft, pending, unpublished and
 * archived. Only an admin may set 'published' or 'rejected' — so an artist
 * cannot put unreviewed work in front of customers. Moderation and sales
 * counters are not artist-writable either.
 */
create or replace function public.artworks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.is_featured := false;
    new.report_count := 0;
    new.units_sold := 0;
    new.rating_average := 0;
    new.rating_count := 0;
    new.views := 0;
    return new;
  end if;

  if new.status in ('published', 'rejected') and new.status is distinct from old.status then
    raise exception
      'Artwork is published by a curator. Submit it for review by setting the status to pending.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.is_featured is distinct from old.is_featured
     or new.moderation_note is distinct from old.moderation_note
     or new.report_count is distinct from old.report_count
     or new.units_sold is distinct from old.units_sold
     or new.rating_average is distinct from old.rating_average
     or new.rating_count is distinct from old.rating_count then
    raise exception 'That field is managed by the marketplace, not the artist.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Submitting for review requires the listing to be complete.
  if new.status = 'pending' and old.status <> 'pending' then
    if jsonb_array_length(new.images) < 1 then
      raise exception 'Add at least one image before submitting for review.'
        using errcode = 'check_violation';
    end if;
    if new.price_minor <= 0 and new.type <> 'commission' then
      raise exception 'Set a price before submitting for review.' using errcode = 'check_violation';
    end if;
    if length(trim(new.description)) = 0 then
      raise exception 'Add a description before submitting for review.' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger artworks_guard_trigger
  before insert or update on public.artworks
  for each row execute function public.artworks_guard();

-- ───────────────────────── Cart and wishlist ─────────────────────────

create policy "carts: own only"
  on public.carts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "cart items: own only"
  on public.cart_items for all
  using (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()));

create policy "wishlist: own only"
  on public.wishlist_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "addresses: own only"
  on public.addresses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ───────────────────────────── Orders ─────────────────────────────
-- A customer sees their own orders. An artist sees an order only because it
-- contains one of their lines — and order_items below still restricts them to
-- their own lines within it.

create policy "orders: customer reads own"
  on public.orders for select
  using (customer_id = auth.uid());

create policy "orders: artist reads orders containing their work"
  on public.orders for select
  using (
    exists (
      select 1 from public.order_items oi
      where oi.order_id = orders.id and oi.artist_user_id = auth.uid()
    )
  );

create policy "orders: admin reads all"
  on public.orders for select
  using (public.is_admin());

create policy "orders: admin manages all"
  on public.orders for all
  using (public.is_admin())
  with check (public.is_admin());

-- No customer INSERT policy: orders are created only by the checkout Edge
-- Function, which prices the cart itself. A client cannot invent an order
-- with its own totals.

create policy "order items: customer reads own"
  on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid()));

create policy "order items: artist reads only their own lines"
  on public.order_items for select
  using (artist_user_id = auth.uid());

create policy "order items: admin reads all"
  on public.order_items for select
  using (public.is_admin());

/**
 * An artist may update ONLY the fulfilment fields on their OWN line. The
 * commission snapshot is already immutable by trigger; this restricts the
 * rest, including anything to do with settlement.
 */
create policy "order items: artist updates own fulfilment"
  on public.order_items for update
  using (artist_user_id = auth.uid())
  with check (artist_user_id = auth.uid());

create policy "order items: admin manages all"
  on public.order_items for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.order_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- An artist must not touch settlement, delivery confirmation, disputes or
  -- refunds: those decide when money is owed and by whom.
  if new.settlement_status is distinct from old.settlement_status
     or new.became_eligible_at is distinct from old.became_eligible_at
     or new.settlement_hold_reason is distinct from old.settlement_hold_reason
     or new.delivery_confirmed_at is distinct from old.delivery_confirmed_at
     or new.delivery_confirmed_via is distinct from old.delivery_confirmed_via
     or new.delivery_confirmed_by is distinct from old.delivery_confirmed_by
     or new.return_window_ends_at is distinct from old.return_window_ends_at
     or new.refunded_minor is distinct from old.refunded_minor
     or new.dispute_open is distinct from old.dispute_open then
    raise exception 'Settlement and delivery confirmation are managed by the marketplace.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Fulfilment may only move forward, along the permitted path.
  if new.fulfilment_status is distinct from old.fulfilment_status then
    if not (
      (old.fulfilment_status = 'awaiting'  and new.fulfilment_status in ('preparing', 'shipped'))
      or (old.fulfilment_status = 'preparing' and new.fulfilment_status = 'shipped')
      or (old.fulfilment_status = 'shipped'   and new.fulfilment_status = 'delivered')
    ) then
      raise exception 'An order item cannot move from % to %.', old.fulfilment_status, new.fulfilment_status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger order_items_guard_trigger
  before update on public.order_items
  for each row execute function public.order_items_guard();

-- ──────────────────── Money tables: read-only to users ────────────────────
-- Writes happen only through Edge Functions using the service role, which
-- bypasses RLS. There is deliberately no INSERT or UPDATE policy here.

create policy "payments: customer reads own"
  on public.payments for select
  using (customer_id = auth.uid());

create policy "payments: admin reads all"
  on public.payments for select
  using (public.is_admin());

create policy "refunds: customer reads own"
  on public.refunds for select
  using (exists (select 1 from public.orders o where o.id = refunds.order_id and o.customer_id = auth.uid()));

create policy "refunds: artist reads own lines"
  on public.refunds for select
  using (
    exists (
      select 1 from public.order_items oi
      where oi.id = refunds.order_item_id and oi.artist_user_id = auth.uid()
    )
  );

create policy "refunds: admin reads all"
  on public.refunds for select
  using (public.is_admin());

create policy "transfers: artist reads own"
  on public.transfers for select
  using (
    exists (
      select 1 from public.order_items oi
      where oi.id = transfers.order_item_id and oi.artist_user_id = auth.uid()
    )
  );

create policy "transfers: admin reads all"
  on public.transfers for select
  using (public.is_admin());

create policy "settlements: admin only"
  on public.settlements for select
  using (public.is_admin());

create policy "webhooks: admin only"
  on public.webhook_events for select
  using (public.is_admin());

-- ───────────────────── Shipments and delivery ─────────────────────

create policy "shipments: customer reads own"
  on public.shipments for select
  using (exists (select 1 from public.orders o where o.id = shipments.order_id and o.customer_id = auth.uid()));

create policy "shipments: artist manages own"
  on public.shipments for all
  using (artist_user_id = auth.uid())
  with check (artist_user_id = auth.uid());

create policy "shipments: admin manages all"
  on public.shipments for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "delivery: customer reads own"
  on public.delivery_confirmations for select
  using (
    exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = delivery_confirmations.order_item_id and o.customer_id = auth.uid()
    )
  );

create policy "delivery: artist reads own"
  on public.delivery_confirmations for select
  using (
    exists (
      select 1 from public.order_items oi
      where oi.id = delivery_confirmations.order_item_id and oi.artist_user_id = auth.uid()
    )
  );

create policy "delivery: admin manages all"
  on public.delivery_confirmations for all
  using (public.is_admin())
  with check (public.is_admin());

-- ───────────────────────────── Reviews ─────────────────────────────

create policy "reviews: public reads visible"
  on public.reviews for select
  using (not is_hidden);

create policy "reviews: author reads own"
  on public.reviews for select
  using (author_id = auth.uid());

/**
 * Only a buyer whose own order contains the piece AND whose line has been
 * delivered may review it. Enforced here, in the database.
 */
create policy "reviews: verified buyer creates"
  on public.reviews for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.id = reviews.order_id
        and o.customer_id = auth.uid()
        and oi.artwork_id = reviews.artwork_id
        and oi.fulfilment_status = 'delivered'
    )
  );

create policy "reviews: author deletes own"
  on public.reviews for delete
  using (author_id = auth.uid());

create policy "reviews: admin manages all"
  on public.reviews for all
  using (public.is_admin())
  with check (public.is_admin());

-- ─────────────────────── Commission requests ───────────────────────

create policy "enquiries: customer reads own"
  on public.commission_requests for select
  using (customer_id = auth.uid());

create policy "enquiries: artist reads own"
  on public.commission_requests for select
  using (artist_user_id = auth.uid());

create policy "enquiries: admin reads all"
  on public.commission_requests for select
  using (public.is_admin());

create policy "enquiries: anyone may send one"
  on public.commission_requests for insert
  with check (customer_id is null or customer_id = auth.uid());

create policy "enquiries: artist responds to own"
  on public.commission_requests for update
  using (artist_user_id = auth.uid())
  with check (artist_user_id = auth.uid());

create policy "enquiries: admin manages all"
  on public.commission_requests for all
  using (public.is_admin())
  with check (public.is_admin());

-- ───────────────────────── Notifications ─────────────────────────

create policy "notifications: read own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications: mark own read"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications: admin manages all"
  on public.notifications for all
  using (public.is_admin())
  with check (public.is_admin());
