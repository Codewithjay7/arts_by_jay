-- ============================================================================
-- Arts by Jay — 0013 admin_artist_stats
--
-- Companion to 0012. The admin artist-applications list showed the same
-- MongoDB-era `stats` document, and because it selects `*` it did not error:
-- `row.stats` simply read as undefined, so every artist appeared to have 0
-- published works and 0 lifetime earnings. The admin had no way to tell an
-- artist with 40 sales from one with none.
--
-- Earnings are NOT added to the artist_public_profiles view, because that
-- view is readable by anonymous visitors and one artist's income is not
-- another's business. This is a separate admin-only function.
--
-- Figures come from the immutable per-line snapshots in order_items, the
-- same source the payout queue settles from, so the admin list and the
-- payout queue cannot disagree.
-- ============================================================================

create or replace function public.admin_artist_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  -- SECURITY DEFINER bypasses RLS, so the privilege check is the only thing
  -- standing between a signed-in customer and every artist's income. It is
  -- first for that reason.
  if not public.is_admin() then
    raise exception 'Only an administrator can view artist statistics.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_object_agg(artist_profile_id, stats), '{}'::jsonb)
  into v_rows
  from (
    select
      ap.id::text as artist_profile_id,
      jsonb_build_object(
        'user_id', ap.user_id,
        'published_artworks', coalesce(art.published_count, 0),
        'total_sales', coalesce(art.units_sold, 0),
        -- Everything the artist has earned on orders that were actually paid
        -- for. Cancelled and unpaid orders are excluded, matching
        -- artist_payout_summary so the two never disagree.
        'lifetime_earnings_minor', coalesce(money.earnings_minor, 0),
        'pending_earnings_minor', coalesce(money.pending_minor, 0),
        'transferred_minor', coalesce(money.transferred_minor, 0)
      ) as stats
    from public.artist_profiles ap
    left join lateral (
      select
        count(*) filter (where a.status = 'published') as published_count,
        coalesce(sum(a.units_sold), 0) as units_sold
      from public.artworks a
      where a.artist_id = ap.id
    ) art on true
    left join lateral (
      select
        coalesce(sum(oi.artist_earnings_minor), 0) as earnings_minor,
        coalesce(sum(oi.artist_earnings_minor) filter (where oi.settlement_status = 'pending'), 0)
          as pending_minor,
        coalesce(sum(oi.artist_earnings_minor) filter (where oi.settlement_status = 'transferred'), 0)
          as transferred_minor
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.artist_user_id = ap.user_id
        and o.status not in ('pending_payment', 'cancelled')
    ) money on true
  ) rows;

  return v_rows;
end;
$$;

comment on function public.admin_artist_stats() is
  'Per-artist published counts and earnings, keyed by artist_profiles.id. Admin only: earnings are deliberately absent from the public artist view.';

revoke all on function public.admin_artist_stats() from public, anon;
grant execute on function public.admin_artist_stats() to authenticated;
