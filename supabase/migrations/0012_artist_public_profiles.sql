-- ============================================================================
-- Arts by Jay — 0012 artist_public_profiles, replacing the absent `stats`
--
-- Defect found on the live site: the Artists page failed outright with
--
--   Could not load the artists: column artist_profiles.stats does not exist
--
-- and the artist storefront and the artist's own dashboard read the same
-- missing column.
--
-- Cause: `stats` is a leftover from the MongoDB build, where an artist
-- document carried an embedded `stats` sub-document. There is no such column
-- in Postgres and there should not be: a stored counter is a second copy of
-- the truth that drifts the moment an artwork is published, unpublished or
-- sold. The numbers belong to `artworks` and are derived here.
--
-- `security_invoker = true` is the important part. The view runs with the
-- CALLER's privileges, so the RLS on artist_profiles and artworks still
-- decides what is visible: an anonymous visitor sees approved artists and
-- their published work, and nothing else. Without it the view would run as
-- its owner and quietly become a way to read around those policies — which
-- is the usual way a view turns into a data leak.
-- ============================================================================

create or replace view public.artist_public_profiles
with (security_invoker = true) as
select
  ap.id,
  ap.user_id,
  ap.display_name,
  ap.slug,
  ap.bio,
  ap.statement,
  ap.location,
  ap.avatar_url,
  ap.cover_url,
  ap.specialities,
  ap.links,
  ap.accepts_commissions,
  ap.commission_note,
  ap.is_featured,
  ap.status,
  ap.review_note,
  ap.created_at,
  -- Counted over the artworks the CALLER can see, which is what makes the
  -- figure honest rather than flattering: an anonymous visitor is shown the
  -- count of work they could actually go and look at.
  coalesce(agg.published_artworks, 0) as published_artworks,
  coalesce(agg.total_sales, 0) as total_sales
from public.artist_profiles ap
left join lateral (
  select
    count(*) filter (where a.status = 'published') as published_artworks,
    coalesce(sum(a.units_sold), 0) as total_sales
  from public.artworks a
  where a.artist_id = ap.id
) agg on true;

comment on view public.artist_public_profiles is
  'artist_profiles plus derived published_artworks and total_sales. Replaces the MongoDB-era `stats` document, which has no Postgres column. security_invoker, so the base tables'' RLS still applies.';

-- The underlying policies do the filtering, so the view is safe to read
-- publicly: an anonymous caller sees exactly the approved artists they
-- already see through artist_profiles.
grant select on public.artist_public_profiles to anon, authenticated;
