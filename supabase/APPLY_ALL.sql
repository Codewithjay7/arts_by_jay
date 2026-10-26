-- ============================================================
-- Arts by Jay - complete schema, generated 2026-10-26T05:51Z
--
-- Paste this whole file into the Supabase SQL Editor and Run.
-- It is migrations 0001 through 0006 concatenated in order.
--
-- Safe to run ONCE on an empty database. Running it twice will
-- error on the first CREATE TYPE - that is expected, not damage.
-- ============================================================


-- ########## 0001_foundation.sql ##########

-- ============================================================================
-- Arts by Jay — 0001 foundation
-- Extensions, enums, money conventions, profiles, roles and audit logging.
--
-- MONEY: every monetary column is `bigint` holding INTEGER PAISE. There is no
-- numeric or float money anywhere in this schema, so totals can never drift.
-- ₹2,000.00 is stored as 200000.
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- ─────────────────────────────── Enums ───────────────────────────────

create type public.user_role as enum ('customer', 'artist', 'admin');

create type public.artist_status as enum ('pending', 'approved', 'rejected', 'suspended');

create type public.artwork_type as enum ('original', 'print', 'digital', 'commission');

create type public.artwork_status as enum (
  'draft', 'pending', 'published', 'rejected', 'unpublished', 'archived'
);

create type public.orientation as enum ('portrait', 'landscape', 'square');

create type public.order_status as enum (
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'eligible_for_settlement', -- earned by the artist, not yet paid out
  'settled',
  'disputed',
  'cancelled',
  'refunded'
);

create type public.fulfilment_status as enum (
  'awaiting', 'preparing', 'shipped', 'delivered', 'cancelled'
);

create type public.payment_status as enum (
  'created', 'pending', 'captured', 'failed', 'refunded', 'partially_refunded', 'disputed', 'cancelled'
);

-- Our obligation to the artist. Deliberately NOT the same thing as the
-- gateway's own settlement state, which lives on `transfers`.
create type public.settlement_status as enum (
  'pending',     -- delivery unconfirmed, or the return window is still open
  'eligible',    -- earned and clear to pay
  'on_hold',     -- blocked by a dispute or refund request
  'processing',  -- a transfer has been requested from the provider
  'transferred', -- the provider has CONFIRMED it
  'failed',
  'reversed'
);

create type public.delivery_source as enum ('carrier', 'admin', 'customer');

create type public.refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');

create type public.linked_account_status as enum (
  'not_started', 'pending', 'needs_clarification', 'activated', 'suspended', 'rejected'
);

create type public.commission_request_status as enum (
  'new', 'in_review', 'quoted', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled'
);

-- ──────────────────────── Shared helper functions ────────────────────────

-- Keeps `updated_at` honest without the application having to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────── Profiles ───────────────────────────────
-- One row per auth.users row. `role` lives HERE, not in JWT app_metadata the
-- client could influence, and RLS reads it from this table every time.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.user_role not null default 'customer',
  avatar_url text not null default '',
  phone text not null default '',
  is_active boolean not null default true,
  suspended_reason text not null default '',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create index profiles_email_idx on public.profiles (lower(email));

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Role helpers ──
-- SECURITY DEFINER so RLS policies can read `profiles` without recursing into
-- the policies on `profiles` itself. search_path is pinned to stop a
-- search_path-hijack from redirecting these lookups.

-- Named `auth_role`, not `current_role`: the latter is a reserved SQL keyword
-- and a built-in function, and shadowing it invites subtle breakage.
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' and is_active from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

-- ── Profile creation on signup ──
-- Runs as the definer so a brand-new user gets a profile before any RLS applies.
--
-- The role is decided HERE, server-side. A client can put anything it likes in
-- raw_user_meta_data, so only 'artist' is honoured as a request; 'admin' is
-- never self-assignable and must be granted by an existing admin or by the
-- bootstrap below.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text := coalesce(new.raw_user_meta_data ->> 'intent', 'customer');
  resolved public.user_role;
  bootstrap_email text;
begin
  select value into bootstrap_email
  from public.platform_settings
  where key = 'admin_bootstrap_email';

  if bootstrap_email is not null
     and bootstrap_email <> ''
     and lower(new.email) = lower(bootstrap_email)
     and not exists (select 1 from public.profiles where role = 'admin')
  then
    resolved := 'admin';
  elsif requested = 'artist' then
    resolved := 'artist';
  else
    resolved := 'customer';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    resolved
  );

  -- An artist signup gets a pending profile straight away so they can start
  -- preparing drafts. Approval is a separate, admin-only act.
  if resolved = 'artist' then
    insert into public.artist_profiles (user_id, display_name, status)
    values (
      new.id,
      coalesce(
        nullif(new.raw_user_meta_data ->> 'artist_name', ''),
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        split_part(new.email, '@', 1)
      ),
      'pending'
    );
  end if;

  insert into public.carts (user_id) values (new.id) on conflict do nothing;

  return new;
end;
$$;

-- ───────────────────────── Platform settings ─────────────────────────
-- Admin-configurable values. The commission rate here applies to FUTURE
-- orders only; every order item snapshots the rate that applied to it.

create table public.platform_settings (
  key text primary key,
  value text not null,
  description text not null default '',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  ('commission_percent', '10',
   'Platform commission on the artwork subtotal, in percent. Applies to new orders only.'),
  ('return_window_days', '7',
   'Days after confirmed delivery before an artist share becomes payable.'),
  ('admin_bootstrap_email', '',
   'The first account created with this email becomes an admin. Blank disables it.'),
  ('razorpay_route_enabled', 'false',
   'Set true ONLY when Razorpay has approved Route on the account.');

create trigger platform_settings_touch
  before update on public.platform_settings
  for each row execute function public.touch_updated_at();

create or replace function public.setting_int(setting_key text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(value, '')::integer from public.platform_settings where key = setting_key),
    fallback
  );
$$;

-- ─────────────────────────────── Audit log ───────────────────────────────
-- Append-only. Nothing may update or delete a row (enforced by RLS in 0005).

create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role public.user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  -- Non-sensitive detail only. Never card data, never secrets.
  detail jsonb not null default '{}'::jsonb,
  ip text not null default '',
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (auth.uid(), public.auth_role(), p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end;
$$;


-- ########## 0002_commerce.sql ##########

-- ============================================================================
-- Arts by Jay — 0002 commerce
-- Catalogue, cart, orders, payments, commission snapshots, settlement.
--
-- All money columns are `bigint` INTEGER PAISE. See 0001.
-- ============================================================================

-- ───────────────────────── Artist profiles ─────────────────────────

create table public.artist_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  display_name text not null,
  slug text not null unique,
  bio text not null default '',
  statement text not null default '',
  location text not null default '',
  avatar_url text not null default '',
  cover_url text not null default '',
  specialities text[] not null default '{}',
  links jsonb not null default '{}'::jsonb,
  accepts_commissions boolean not null default true,
  commission_note text not null default '',

  status public.artist_status not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  review_note text not null default '',
  is_featured boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index artist_profiles_status_idx on public.artist_profiles (status);
create index artist_profiles_name_trgm on public.artist_profiles using gin (display_name extensions.gin_trgm_ops);

-- Slugs are generated server-side; a client-supplied slug is never trusted.
create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.artist_slug_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  if new.slug is not null and new.slug <> ''
     and tg_op = 'UPDATE' and new.display_name = old.display_name then
    return new;
  end if;

  base := nullif(public.slugify(new.display_name), '');
  base := coalesce(base, 'artist');
  candidate := base;

  while exists (
    select 1 from public.artist_profiles
    where slug = candidate and (tg_op = 'INSERT' or id <> new.id)
  ) loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger artist_profiles_slug
  before insert or update on public.artist_profiles
  for each row execute function public.artist_slug_guard();

create trigger artist_profiles_touch
  before update on public.artist_profiles
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Linked accounts ─────────────────────────
-- Razorpay Route linked-account references.
--
-- Deliberately holds NO bank details and NO identity documents: Razorpay
-- collects and holds those. We keep only the provider id and a status.

create table public.artist_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  artist_id uuid not null unique references public.artist_profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  provider text not null default 'razorpay',
  -- Razorpay's `acc_...` id. Unique so one linked account cannot be attached
  -- to two artists, which would misdirect money.
  provider_account_id text unique,
  provider_product_id text,

  status public.linked_account_status not null default 'not_started',
  -- Razorpay's own requirement list, echoed back for the artist to act on.
  requirements jsonb not null default '[]'::jsonb,
  status_detail text not null default '',

  -- Payouts are refused unless this is true AND status = 'activated'.
  payouts_enabled boolean not null default false,

  onboarding_started_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index artist_accounts_status_idx on public.artist_accounts (status);

create trigger artist_accounts_touch
  before update on public.artist_accounts
  for each row execute function public.touch_updated_at();

-- ───────────────────────────── Categories ─────────────────────────────

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  parent_id uuid references public.categories (id) on delete restrict,
  image_url text not null default '',
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_parent_idx on public.categories (parent_id);

create trigger categories_touch
  before update on public.categories
  for each row execute function public.touch_updated_at();

-- ───────────────────────────── Artworks ─────────────────────────────

create table public.artworks (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null default '',
  story text not null default '',

  artist_id uuid not null references public.artist_profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,

  style text not null default '',
  medium text not null default '',
  year integer check (year is null or (year between 1800 and 2200)),
  tags text[] not null default '{}',

  type public.artwork_type not null default 'original',
  -- INTEGER PAISE.
  price_minor bigint not null check (price_minor >= 0),
  compare_at_price_minor bigint check (compare_at_price_minor is null or compare_at_price_minor >= 0),
  currency char(3) not null default 'INR',

  stock integer not null default 1 check (stock >= 0),
  is_unique boolean not null default false,
  allow_backorder boolean not null default false,

  width_cm numeric(8, 2),
  height_cm numeric(8, 2),
  depth_cm numeric(8, 2),
  weight_grams integer,
  orientation public.orientation not null default 'portrait',
  is_framed boolean not null default false,

  images jsonb not null default '[]'::jsonb,

  ships_from text not null default '',
  processing_days integer not null default 3 check (processing_days between 0 and 90),
  shipping_flat_minor bigint not null default 0 check (shipping_flat_minor >= 0),
  is_digital_delivery boolean not null default false,

  status public.artwork_status not null default 'draft',
  published_at timestamptz,
  moderated_at timestamptz,
  moderated_by uuid references public.profiles (id),
  moderation_note text not null default '',
  report_count integer not null default 0,

  is_featured boolean not null default false,
  in_virtual_gallery boolean not null default true,

  views integer not null default 0,
  units_sold integer not null default 0,
  rating_average numeric(2, 1) not null default 0,
  rating_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The storefront's hot path: published, newest first.
create index artworks_published_idx on public.artworks (status, published_at desc);
create index artworks_price_idx on public.artworks (status, price_minor);
create index artworks_artist_idx on public.artworks (artist_id, status);
create index artworks_category_idx on public.artworks (category_id, status);
create index artworks_gallery_idx on public.artworks (status, in_virtual_gallery) where in_virtual_gallery;
create index artworks_tags_idx on public.artworks using gin (tags);
-- Full-text search over the fields buyers actually type.
create index artworks_search_idx on public.artworks using gin (
  to_tsvector('english', title || ' ' || description || ' ' || medium || ' ' || style)
);

-- Uniqueness and digital delivery are DERIVED from the type, never trusted
-- from whatever was submitted.
create or replace function public.artwork_normalise()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  new.is_unique := (new.type = 'original');
  if new.type = 'original' and new.stock > 1 then
    new.stock := 1;
  end if;
  if new.type = 'digital' then
    new.is_digital_delivery := true;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  if new.slug is null or new.slug = ''
     or (tg_op = 'UPDATE' and new.title <> old.title) then
    base := coalesce(nullif(public.slugify(new.title), ''), 'artwork');
    candidate := base;
    while exists (
      select 1 from public.artworks
      where slug = candidate and (tg_op = 'INSERT' or id <> new.id)
    ) loop
      suffix := suffix + 1;
      candidate := base || '-' || suffix;
    end loop;
    new.slug := candidate;
  end if;

  return new;
end;
$$;

create trigger artworks_normalise
  before insert or update on public.artworks
  for each row execute function public.artwork_normalise();

create trigger artworks_touch
  before update on public.artworks
  for each row execute function public.touch_updated_at();

-- ─────────────────────── Cart, wishlist, addresses ───────────────────────

create table public.carts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default extensions.gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 50),
  -- The price when it was added, so "this price changed" can be reported
  -- rather than silently charging the new one.
  price_at_add_minor bigint not null check (price_at_add_minor >= 0),
  added_at timestamptz not null default now(),
  unique (cart_id, artwork_id)
);

create table public.wishlist_items (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, artwork_id)
);

create table public.addresses (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text not null,
  line1 text not null,
  line2 text not null default '',
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id, is_default desc);

-- ───────────────────────────── Orders ─────────────────────────────

create table public.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  customer_email text not null,

  subtotal_minor bigint not null check (subtotal_minor >= 0),
  shipping_total_minor bigint not null default 0 check (shipping_total_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  currency char(3) not null default 'INR',

  -- Frozen snapshots: the listing may be edited or deleted later.
  shipping_address jsonb not null,
  billing_address jsonb,
  shipping_method text not null default 'standard',
  customer_note text not null default '',

  status public.order_status not null default 'pending_payment',
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '',

  -- Guards a double-submitted checkout. Unique per customer.
  idempotency_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_total_adds_up
    check (total_minor = subtotal_minor + shipping_total_minor - discount_minor)
);

create unique index orders_idempotency_idx
  on public.orders (customer_id, idempotency_key)
  where idempotency_key is not null;

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ─────────────────────────── Order items ───────────────────────────
-- The commission snapshot lives here. This is the financial record of record.

create table public.order_items (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete restrict,
  artist_id uuid not null references public.artist_profiles (id) on delete restrict,
  artist_user_id uuid not null references public.profiles (id) on delete restrict,

  -- Immutable snapshot of the listing as sold.
  title text not null,
  slug text not null default '',
  image_url text not null default '',
  type public.artwork_type not null default 'original',
  medium text not null default '',

  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  shipping_minor bigint not null default 0 check (shipping_minor >= 0),

  -- ── COMMISSION SNAPSHOT ──
  -- The rate and the basis it applied to, frozen at purchase. Changing the
  -- platform rate later cannot rewrite what this artist was owed.
  -- The basis is the artwork line total, EXCLUDING shipping.
  commission_rate_percent numeric(5, 2) not null check (commission_rate_percent between 0 and 100),
  commission_basis_minor bigint not null check (commission_basis_minor >= 0),
  commission_minor bigint not null check (commission_minor >= 0),
  artist_earnings_minor bigint not null check (artist_earnings_minor >= 0),

  fulfilment_status public.fulfilment_status not null default 'awaiting',
  tracking_carrier text not null default '',
  tracking_number text not null default '',
  tracking_url text not null default '',
  shipped_at timestamptz,
  delivered_at timestamptz,

  -- ── Delivery confirmation and return window ──
  delivery_confirmed_at timestamptz,
  delivery_confirmed_via public.delivery_source,
  delivery_confirmed_by uuid references public.profiles (id),
  delivery_evidence_ref text not null default '',
  return_window_days integer,
  return_window_ends_at timestamptz,

  -- ── Settlement (our obligation to the artist, NOT money movement) ──
  settlement_status public.settlement_status not null default 'pending',
  became_eligible_at timestamptz,
  settlement_hold_reason text not null default '',

  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  dispute_open boolean not null default false,
  dispute_reason text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The split must always reconcile exactly.
  constraint order_items_commission_adds_up
    check (commission_minor + artist_earnings_minor = commission_basis_minor),
  constraint order_items_line_adds_up
    check (line_total_minor = unit_price_minor * quantity),
  constraint order_items_refund_within_line
    check (refunded_minor <= line_total_minor + shipping_minor)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_artist_idx on public.order_items (artist_user_id, created_at desc);
-- The payout sweep: which lines are payable now?
create index order_items_settlement_idx
  on public.order_items (settlement_status, return_window_ends_at);

create trigger order_items_touch
  before update on public.order_items
  for each row execute function public.touch_updated_at();

-- ── Commission rate is immutable once written ──
-- A trigger rather than a policy, so it holds even for the service role.

create or replace function public.order_items_protect_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.commission_rate_percent is distinct from old.commission_rate_percent
     or new.commission_basis_minor is distinct from old.commission_basis_minor
     or new.commission_minor is distinct from old.commission_minor
     or new.artist_earnings_minor is distinct from old.artist_earnings_minor
     or new.unit_price_minor is distinct from old.unit_price_minor
     or new.line_total_minor is distinct from old.line_total_minor
  then
    raise exception
      'The commission snapshot on an order item is immutable (item %). Historical orders must keep the rate and amounts that applied when they were placed.',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger order_items_snapshot_immutable
  before update on public.order_items
  for each row execute function public.order_items_protect_snapshot();

-- ───────────────────────────── Payments ─────────────────────────────

create table public.payments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,

  provider text not null default 'razorpay',
  provider_order_id text,
  provider_payment_id text,

  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'INR',

  status public.payment_status not null default 'created',
  failure_reason text not null default '',

  -- Set ONLY by a verified webhook or a verified server-side signature check.
  -- A browser-reported success never sets this.
  verified_at timestamptz,
  verified_via text not null default '' check (verified_via in ('', 'webhook', 'signature', 'reconciliation')),

  refunded_minor bigint not null default 0 check (refunded_minor >= 0),

  -- Non-sensitive gateway echo only. Never card numbers, never CVV.
  provider_meta jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_refund_within_amount check (refunded_minor <= amount_minor)
);

-- One captured payment per provider reference: blocks double-crediting.
create unique index payments_provider_payment_idx
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index payments_provider_order_idx
  on public.payments (provider, provider_order_id)
  where provider_order_id is not null;

create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status, created_at desc);

create trigger payments_touch
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Webhook events ─────────────────────────
-- Idempotency ledger. A replayed delivery hits the unique index and is
-- skipped, so a payment can never be settled twice.

create table public.webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_event_id text not null,
  event_type text not null,

  signature_verified boolean not null default false,
  processed_at timestamptz,
  processing_error text not null default '',
  attempts integer not null default 0,

  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),

  unique (provider, provider_event_id)
);

create index webhook_events_unprocessed_idx
  on public.webhook_events (provider, received_at)
  where processed_at is null;

-- ───────────────────────── Shipments & delivery ─────────────────────────

create table public.shipments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  artist_user_id uuid not null references public.profiles (id) on delete restrict,

  carrier text not null default '',
  tracking_number text not null default '',
  tracking_url text not null default '',
  shipped_at timestamptz not null default now(),
  estimated_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_order_idx on public.shipments (order_id);

create table public.delivery_confirmations (
  id uuid primary key default extensions.gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete set null,

  source public.delivery_source not null,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz not null default now(),
  -- A carrier reference, a POD id, or an admin's note. Auditable evidence.
  evidence_ref text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index delivery_confirmations_item_idx on public.delivery_confirmations (order_item_id);

-- ───────────────────────────── Refunds ─────────────────────────────

create table public.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  order_item_id uuid references public.order_items (id) on delete set null,
  payment_id uuid not null references public.payments (id) on delete restrict,

  amount_minor bigint not null check (amount_minor > 0),
  reason text not null default '',
  status public.refund_status not null default 'requested',

  requested_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),

  provider_refund_id text,
  provider_status text not null default '',
  -- Gateway fees are generally NOT returned on a refund. Recorded so the
  -- platform's own loss is visible rather than hidden.
  provider_fee_retained_minor bigint not null default 0,

  -- How the refund was shared. Commission is normally returned in full;
  -- anything else must be an explicit, recorded decision.
  commission_reversed_minor bigint not null default 0,
  artist_share_reversed_minor bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Blocks a duplicate refund against the same provider reference.
create unique index refunds_provider_idx
  on public.refunds (provider_refund_id)
  where provider_refund_id is not null;

create index refunds_order_idx on public.refunds (order_id, created_at desc);

create trigger refunds_touch
  before update on public.refunds
  for each row execute function public.touch_updated_at();

-- ──────────────────────── Transfers & settlements ────────────────────────
-- Razorpay Route transfers. Separate from `order_items.settlement_status`
-- precisely because our intent and the provider's reality can diverge.

create table public.transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  artist_account_id uuid not null references public.artist_accounts (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete set null,

  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'INR',

  provider text not null default 'razorpay',
  provider_transfer_id text,
  provider_status text not null default '',
  -- Route's own settlement hold, if used.
  on_hold boolean not null default false,
  on_hold_until timestamptz,

  -- Our idempotency key, so a retry cannot create a second transfer.
  idempotency_key text not null,

  requested_at timestamptz not null default now(),
  settled_at timestamptz,
  failure_reason text not null default '',
  attempts integer not null default 0,

  -- True when the money moved outside the gateway (a manual bank transfer).
  -- This is the honest option while Route is unapproved.
  out_of_band boolean not null default false,
  out_of_band_reference text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index transfers_idempotency_idx on public.transfers (idempotency_key);
create unique index transfers_provider_idx
  on public.transfers (provider, provider_transfer_id)
  where provider_transfer_id is not null;
-- At most one live transfer per order item.
create unique index transfers_one_live_per_item
  on public.transfers (order_item_id)
  where provider_status not in ('failed', 'reversed');

create trigger transfers_touch
  before update on public.transfers
  for each row execute function public.touch_updated_at();

-- Provider settlement batches, for reconciliation against our own records.
create table public.settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_settlement_id text not null,
  amount_minor bigint not null,
  fees_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  status text not null default '',
  settled_at timestamptz,
  -- Set once our records have been matched against this batch.
  reconciled_at timestamptz,
  reconciliation_note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_settlement_id)
);

-- ─────────────────── Reviews, commissions, notifications ───────────────────

create table public.reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- Required: only a verified buyer may review.
  order_id uuid not null references public.orders (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text not null default '',
  body text not null default '',
  is_verified_purchase boolean not null default true,
  is_hidden boolean not null default false,
  hidden_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artwork_id, author_id)
);

create index reviews_artwork_idx on public.reviews (artwork_id) where not is_hidden;

create table public.commission_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique,
  kind text not null default 'commission' check (kind in ('commission', 'enquiry', 'photo_to_art')),

  customer_id uuid references public.profiles (id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null default '',

  artist_id uuid references public.artist_profiles (id) on delete set null,
  artist_user_id uuid references public.profiles (id) on delete set null,
  artwork_id uuid references public.artworks (id) on delete set null,

  subject text not null default '',
  message text not null,
  style_key text not null default '',
  reference_images jsonb not null default '[]'::jsonb,
  -- Explicit, recorded consent before a private photo is stored or passed on.
  photo_consent boolean not null default false,

  preferred_size text not null default '',
  budget_minor bigint,
  deadline date,

  status public.commission_request_status not null default 'new',
  quoted_amount_minor bigint,
  quote_note text not null default '',
  messages jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commission_requests_artist_idx
  on public.commission_requests (artist_user_id, status, created_at desc);

create trigger commission_requests_touch
  before update on public.commission_requests
  for each row execute function public.touch_updated_at();

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ─────────────── The new-user trigger, now that tables exist ───────────────

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ########## 0003_rls.sql ##########

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


-- ########## 0004_pricing_payouts_storage.sql ##########

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


-- ########## 0005_settlement_functions.sql ##########

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


-- ########## 0006_client_rpcs.sql ##########

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

