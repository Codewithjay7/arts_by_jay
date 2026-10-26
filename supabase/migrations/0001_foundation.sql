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
