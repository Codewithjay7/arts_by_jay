import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Globe, Instagram, MapPin, Search, Users } from 'lucide-react';
import { listArtists, getArtistStorefront } from '../lib/data/artist';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Pagination,
  SectionHeader,
  Skeleton,
} from '../components/ui';
import { ArtworkGrid } from '../components/art/ArtworkGrid';
import { Reveal } from '../components/motion/Reveal';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks';
import { imageSource } from '../lib/images';
import { formatDate, pluralise } from '../lib/format';

/* ──────────────────────── Artist directory ──────────────────────── */

export const ArtistsPage = () => {
  useDocumentTitle('Artists');

  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(term.trim(), 350);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artists', debounced, page],
    queryFn: () => listArtists({ q: debounced || undefined, page, limit: 12 }),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="space-y-5">
        <div className="space-y-2">
          <p className="eyebrow">The people behind the work</p>
          <h1 className="text-display-lg">Artists</h1>
          <p className="lede max-w-2xl">
            Every piece on Arts by Jay is listed, priced and dispatched by the artist who made it. These
            are their storefronts.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search artists by name…"
            aria-label="Search artists"
            className="h-12 rounded-full pl-11"
          />
        </div>
      </header>

      <div className="mt-10">
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-72" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : !data?.items?.length ? (
          <EmptyState
            icon={Users}
            title={debounced ? `No artist matched “${debounced}”` : 'No artists yet'}
            message={
              debounced
                ? 'Try a shorter name, or browse everyone.'
                : 'No artists have been approved on this marketplace yet.'
            }
            action={
              debounced ? (
                <Button variant="secondary" onClick={() => setTerm('')}>
                  Show all artists
                </Button>
              ) : (
                <Button variant="primary" to="/become-an-artist">
                  Be the first
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((artist, index) => (
                <Reveal key={artist.id} delay={Math.min(index, 5) * 70}>
                  <ArtistCard artist={artist} />
                </Reveal>
              ))}
            </div>

            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onChange={(next) => {
                setPage(next);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="pt-12"
            />
          </>
        )}
      </div>
    </div>
  );
};

const ArtistCard = ({ artist }) => (
  <Link
    to={`/artists/${artist.slug}`}
    className="group block overflow-hidden rounded-2xl border border-line bg-surface-0/60 transition-colors hover:border-accent-300/40"
  >
    {/* Three works, so the card is led by art rather than a biography. */}
    <div className="grid grid-cols-3 gap-0.5 bg-surface-100">
      {artist.preview.length > 0 ? (
        artist.preview.map((piece) => (
          <div key={piece.id} className="aspect-square overflow-hidden bg-surface-150">
            {piece.image && (
              <img
                src={imageSource({ url: piece.image })}
                alt=""
                className="h-full w-full object-cover transition-transform duration-700 ease-gallery group-hover:scale-105"
                loading="lazy"
              />
            )}
          </div>
        ))
      ) : (
        <div className="col-span-3 grid aspect-[3/1] place-items-center bg-surface-150 text-[0.75rem] text-muted">
          No published work yet
        </div>
      )}
    </div>

    <div className="space-y-3 p-5">
      <div className="flex items-start gap-3.5">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface-150">
          {artist.avatarUrl && (
            <img
              src={imageSource({ url: artist.avatarUrl })}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl transition-colors group-hover:text-accent-300">
            {artist.displayName}
          </h2>
          {artist.location && (
            <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[0.76rem] text-muted">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {artist.location}
            </p>
          )}
        </div>
        {artist.isFeatured && <Badge tone="accent">Featured</Badge>}
      </div>

      {artist.bio && <p className="line-clamp-2 text-[0.84rem] leading-relaxed text-muted">{artist.bio}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
        <span>{pluralise(artist.publishedArtworks, 'work')}</span>
        {artist.acceptsCommissions && <span className="text-accent-300">Commissions open</span>}
      </div>
    </div>
  </Link>
);

/* ──────────────────────── Artist storefront ──────────────────────── */

export const ArtistStorefrontPage = () => {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-storefront', slug, page],
    queryFn: () => getArtistStorefront(slug, { page, limit: 12 }),
    retry: false,
    placeholderData: (previous) => previous,
  });

  useDocumentTitle(data?.artist?.displayName);

  if (isLoading) return <LoadingBlock label="Opening the storefront" className="min-h-[70vh]" />;

  if (isError) {
    const notFound = error?.status === 404;

    return (
      <div className="mx-auto max-w-3xl px-4 py-24">
        {notFound ? (
          <EmptyState
            icon={Users}
            title="That storefront is not available"
            message="The artist may not be approved yet, or the link may be out of date."
            action={
              <Button variant="primary" to="/artists">
                See all artists
              </Button>
            }
          />
        ) : (
          <ErrorState message={error?.message} onRetry={refetch} />
        )}
      </div>
    );
  }

  const { artist } = data;

  return (
    <div>
      {/* ── Cover ── */}
      <header className="relative">
        <div className="relative h-48 overflow-hidden sm:h-64 lg:h-80">
          {artist.coverUrl ? (
            <img
              src={imageSource({ url: artist.coverUrl })}
              alt=""
              className="h-full w-full object-cover opacity-55"
            />
          ) : (
            <div className="h-full w-full bg-gallery-wall" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-surface-100/50 to-transparent" />
        </div>

        <div className="mx-auto -mt-16 max-w-[1500px] px-4 sm:px-6 lg:-mt-20 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-5">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-2 border-line bg-surface-0 shadow-frame lg:h-32 lg:w-32">
                {artist.avatarUrl && (
                  <img
                    src={imageSource({ url: artist.avatarUrl })}
                    alt={artist.displayName}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="space-y-1.5 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  {artist.isFeatured && <Badge tone="accent">Featured artist</Badge>}
                  {artist.acceptsCommissions && <Badge tone="positive">Commissions open</Badge>}
                </div>
                <h1 className="text-display-md">{artist.displayName}</h1>
                {artist.location && (
                  <p className="inline-flex items-center gap-1.5 text-[0.84rem] text-muted">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {artist.location}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 pb-2">
              {artist.acceptsCommissions && (
                <Button variant="primary" to={`/studio?artist=${artist.slug}`}>
                  Commission a piece
                </Button>
              )}
              <Button variant="secondary" to={`/shop?artist=${artist.slug}`}>
                Filter the shop
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[18rem_1fr]">
          {/* ── Biography rail ── */}
          <aside className="space-y-7">
            {artist.statement && (
              <blockquote className="border-l-2 border-accent-300/40 pl-4">
                <p className="font-display text-lg italic leading-relaxed text-ink/90">
                  “{artist.statement}”
                </p>
              </blockquote>
            )}

            {artist.bio && (
              <div className="space-y-2">
                <h2 className="eyebrow">About</h2>
                <p className="whitespace-pre-line text-[0.86rem] leading-relaxed text-muted">{artist.bio}</p>
              </div>
            )}

            {artist.specialities?.length > 0 && (
              <div className="space-y-2.5">
                <h2 className="eyebrow">Works in</h2>
                <div className="flex flex-wrap gap-1.5">
                  {artist.specialities.map((speciality) => (
                    <Badge key={speciality}>{speciality}</Badge>
                  ))}
                </div>
              </div>
            )}

            <dl className="space-y-3 border-t border-line pt-5 text-[0.82rem]">
              <div className="flex justify-between">
                <dt className="text-muted">Works listed</dt>
                <dd className="text-ink">{artist.publishedArtworks}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Pieces sold</dt>
                <dd className="text-ink">{artist.totalSales}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">On Arts by Jay since</dt>
                <dd className="text-ink">{formatDate(artist.joinedAt, { day: undefined })}</dd>
              </div>
            </dl>

            {(artist.links?.website || artist.links?.instagram) && (
              <div className="space-y-2.5 border-t border-line pt-5">
                <h2 className="eyebrow">Elsewhere</h2>
                <div className="flex gap-2">
                  {artist.links.website && (
                    <a
                      href={artist.links.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
                      aria-label={`${artist.displayName} website`}
                    >
                      <Globe className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                  {artist.links.instagram && (
                    <a
                      href={
                        artist.links.instagram.startsWith('http')
                          ? artist.links.instagram
                          : `https://instagram.com/${artist.links.instagram.replace('@', '')}`
                      }
                      target="_blank"
                      rel="noreferrer noopener"
                      className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
                      aria-label={`${artist.displayName} on Instagram`}
                    >
                      <Instagram className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {artist.commissionNote && (
              <div className="space-y-2 rounded-2xl border border-accent-300/20 bg-accent-300/[0.04] p-4">
                <h2 className="eyebrow">On commissions</h2>
                <p className="text-[0.82rem] leading-relaxed text-muted">{artist.commissionNote}</p>
              </div>
            )}
          </aside>

          {/* ── The work ── */}
          <div className="space-y-8">
            <SectionHeader
              eyebrow="Available work"
              title={`${data.meta.total} ${data.meta.total === 1 ? 'piece' : 'pieces'}`}
            />

            <ArtworkGrid
              artworks={data.artworks}
              columns="wide"
              emptyTitle="Nothing listed yet"
              emptyMessage={`${artist.displayName} has not published any work to the marketplace yet.`}
            />

            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onChange={(next) => {
                setSearchParams({ page: String(next) }, { replace: true });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="pt-6"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtistsPage;
