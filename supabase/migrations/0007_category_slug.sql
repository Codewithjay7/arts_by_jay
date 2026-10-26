-- ============================================================================
-- Arts by Jay — 0007 category slug generation
--
-- Fixes a real defect found on first apply: `categories.slug` is NOT NULL,
-- but 0002 only added slug-generating triggers to `artist_profiles` and
-- `artworks`. Inserting a category therefore failed with a not-null
-- violation, because nothing ever filled the column in.
--
-- The slug is generated server-side rather than accepted from the client, for
-- the same reason it is on the other two tables: a slug is part of a public
-- URL, and letting a caller choose it invites collisions and impersonation of
-- an existing path.
-- ============================================================================

create or replace function public.category_slug_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  -- Nothing to do when the name has not changed and a slug already exists.
  if tg_op = 'UPDATE'
     and new.slug is not null and new.slug <> ''
     and new.name = old.name then
    return new;
  end if;

  base := coalesce(nullif(public.slugify(new.name), ''), 'category');
  candidate := base;

  while exists (
    select 1 from public.categories
    where slug = candidate and (tg_op = 'INSERT' or id <> new.id)
  ) loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger categories_slug
  before insert or update on public.categories
  for each row execute function public.category_slug_guard();

-- Backfill anything that slipped in before the trigger existed. The loop is
-- needed rather than a single UPDATE because each generated slug has to be
-- unique against the rows already updated.
do $$
declare
  row_data record;
  base text;
  candidate text;
  suffix integer;
begin
  for row_data in
    select id, name from public.categories where slug is null or slug = ''
  loop
    base := coalesce(nullif(public.slugify(row_data.name), ''), 'category');
    candidate := base;
    suffix := 1;

    while exists (select 1 from public.categories where slug = candidate) loop
      suffix := suffix + 1;
      candidate := base || '-' || suffix;
    end loop;

    update public.categories set slug = candidate where id = row_data.id;
  end loop;
end;
$$;
