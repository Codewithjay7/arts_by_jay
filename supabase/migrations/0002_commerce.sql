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
