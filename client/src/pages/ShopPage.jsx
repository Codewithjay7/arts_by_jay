import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { Button, Input, Modal, Pagination } from '../components/ui';
import { ArtworkGrid } from '../components/art/ArtworkGrid';
import {
  ActiveFilters,
  FILTER_KEYS,
  FilterPanel,
  FilterToggle,
  SortControl,
} from '../components/art/FilterPanel';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks';

/**
 * The ordinary shop.
 *
 * Filters live in the URL, so a filtered view can be shared, bookmarked and
 * navigated back to. The URL is the single source of truth; nothing is
 * duplicated in component state except the search box, which is debounced.
 */
export const ShopPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const filters = useMemo(() => {
    const entries = {};
    FILTER_KEYS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) entries[key] = value;
    });
    return entries;
  }, [searchParams]);

  const sort = searchParams.get('sort') ?? 'newest';
  const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);

  const [searchInput, setSearchInput] = useState(filters.q ?? '');
  const debouncedSearch = useDebouncedValue(searchInput, 400);

  useDocumentTitle(filters.q ? `Search: ${filters.q}` : 'Explore Artwork');

  /** Writes filters back to the URL, resetting to page 1 on any change. */
  const updateParams = useCallback(
    (changes, { keepPage = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          Object.entries(changes).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          });

          if (!keepPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Keep the box in step when the URL changes from elsewhere (a nav link,
  // the back button, a chip being removed).
  useEffect(() => {
    setSearchInput(filters.q ?? '');
  }, [filters.q]);

  // Commit the debounced term, but only when it actually differs.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (debouncedSearch !== current) {
      updateParams({ q: debouncedSearch || undefined });
    }
    // `searchParams` is deliberately omitted: including it would re-run this
    // on every URL change and fight the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, updateParams]);

  const queryParams = { ...filters, sort, page, limit: 12 };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['artworks', queryParams],
    queryFn: async () => {
      const { data: result } = await api.get('/artworks', { params: queryParams });
      return result;
    },
    // Keeps the previous page visible while the next one loads, instead of
    // flashing an empty grid on every page change.
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });

  const facets = useQuery({
    queryKey: ['artwork-facets'],
    queryFn: async () => {
      const { data: result } = await api.get('/artworks/facets');
      return result;
    },
    staleTime: 10 * 60 * 1000,
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data: result } = await api.get('/categories');
      return result;
    },
    staleTime: 10 * 60 * 1000,
  });

  const activeCount = FILTER_KEYS.filter((key) => filters[key]).length;

  const clearAll = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const filterPanel = (
    <FilterPanel
      filters={filters}
      onChange={(changes) => updateParams(changes)}
      categories={categories.data?.items ?? []}
      facets={facets.data}
    />
  );

  const headline = filters.q
    ? `Results for “${filters.q}”`
    : data?.filters?.category?.name
      ? data.filters.category.name
      : data?.filters?.artist?.displayName
        ? `Work by ${data.filters.artist.displayName}`
        : 'Explore artwork';

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      {/* ── Header ── */}
      <header className="space-y-5">
        <div className="space-y-2">
          <p className="eyebrow">The collection</p>
          <h1 className="text-display-lg">{headline}</h1>
          {!filters.q && !activeCount && (
            <p className="lede max-w-2xl">
              Originals, limited prints and digital work from every artist on the platform. Filter by what
              matters to you, or walk the{' '}
              <a href="/gallery" className="text-lime-300 underline-offset-4 hover:underline">
                virtual gallery
              </a>{' '}
              instead.
            </p>
          )}
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by title, artist, medium, style or tag…"
            aria-label="Search artwork"
            className="h-12 rounded-full pl-11 pr-11"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-3.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-parchment"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="mt-10 lg:grid lg:grid-cols-[16rem_1fr] lg:gap-12">
        {/* ── Desktop filter rail ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="eyebrow">Refine</h2>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[0.75rem] text-muted underline-offset-4 hover:text-lime-300 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            {filterPanel}
          </div>
        </aside>

        {/* ── Results ── */}
        <div className="space-y-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <FilterToggle
              activeCount={activeCount}
              onClick={() => setFilterSheetOpen(true)}
              className="lg:hidden"
            />
            <SortControl
              value={sort}
              onChange={(value) => updateParams({ sort: value })}
              total={data?.meta?.total}
              className="ml-auto"
            />
          </div>

          <ActiveFilters
            filters={filters}
            onRemove={(key) => {
              if (key === 'q') setSearchInput('');
              updateParams({ [key]: undefined });
            }}
            onClear={clearAll}
            categories={categories.data?.flat}
            facets={facets.data}
          />

          <div
            // A soft dim while the next page loads reads as "working" without
            // tearing the grid down and rebuilding it.
            className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            aria-busy={isFetching}
          >
            <ArtworkGrid
              artworks={data?.items ?? []}
              isLoading={isLoading}
              isError={isError}
              error={errorMessage(error)}
              onRetry={refetch}
              emptyTitle={filters.q ? `Nothing matched “${filters.q}”` : 'No artwork matches those filters'}
              emptyMessage={
                activeCount > 0
                  ? 'Try removing a filter, or clear them all to see the whole collection.'
                  : 'The collection is empty for now. Please check back soon.'
              }
              emptyAction={
                activeCount > 0 ? (
                  <Button variant="secondary" onClick={clearAll}>
                    Clear all filters
                  </Button>
                ) : (
                  <Button variant="primary" to="/gallery">
                    Visit the gallery
                  </Button>
                )
              }
            />
          </div>

          <Pagination
            page={data?.meta?.page ?? 1}
            totalPages={data?.meta?.totalPages ?? 1}
            onChange={(next) => {
              updateParams({ page: next }, { keepPage: true });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="pt-6"
          />
        </div>
      </div>

      {/* ── Mobile filter sheet ── */}
      <Modal
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Refine the collection"
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button
              variant="ghost"
              onClick={() => {
                clearAll();
                setFilterSheetOpen(false);
              }}
              className="flex-1"
            >
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setFilterSheetOpen(false)} className="flex-1">
              Show {data?.meta?.total ?? 0} works
            </Button>
          </div>
        }
      >
        {filterPanel}
      </Modal>
    </div>
  );
};

export default ShopPage;
