import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Brush, Frame, Palette, Search, Sparkles } from 'lucide-react';
import api from '../lib/api';
import { Button, SectionHeader, Skeleton } from '../components/ui';
import { ArtworkRail } from '../components/art/ArtworkGrid';
import { ArtworkCard } from '../components/art/ArtworkCard';
import { Reveal } from '../components/motion/Reveal';
import { useDocumentTitle } from '../lib/hooks';
import { imageSource } from '../lib/images';
import { useUi } from '../store/ui';
import { formatMoney } from '../lib/format';

export const HomePage = () => {
  useDocumentTitle('Original Art, Prints and an Immersive Gallery');
  const openSearch = useUi((state) => state.openSearch);

  const collections = useQuery({
    queryKey: ['home-collections'],
    queryFn: async () => {
      const { data } = await api.get('/artworks/collections');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await api.get('/categories');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const artists = useQuery({
    queryKey: ['featured-artists'],
    queryFn: async () => {
      const { data } = await api.get('/artists', { params: { featured: true, limit: 4 } });
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const hero = collections.data?.featured?.[0] ?? collections.data?.newArrivals?.[0];

  return (
    <>
      {/* ───────────────────────── Hero ───────────────────────── */}
      {/*
        A product launch, for a painting.

        Centred type over white, then the work itself presented large and
        uncropped below it. No background image behind the headline: a blurred
        painting under text is decoration, and it fights the artwork it is
        supposed to be selling.
      */}
      <section className="relative overflow-hidden bg-surface-0">
        <div className="mx-auto max-w-[1024px] px-4 pb-10 pt-20 text-center sm:px-6 sm:pt-28">
          <Reveal>
            <p className="eyebrow">New works, every week</p>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="mt-3 text-display-xl">Art that moves you.</h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="lede mx-auto mt-5 max-w-2xl text-balance">
              Discover original works by independent artists. Find a piece that feels like yours.
            </p>
          </Reveal>

          <Reveal delay={210}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
              <Button variant="primary" size="lg" to="/shop">
                Explore the collection
              </Button>
              {/* A text link, not a second button. Apple's secondary action is
                  always lighter in weight than the primary one. */}
              <Link
                to="/artists"
                className="inline-flex items-center gap-1.5 text-[1.0625rem] text-accent-300 transition-colors hover:text-accent-200"
              >
                Meet the artists
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </div>

        {/* ── The featured work, full width and uncropped ── */}
        <div className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-6">
          {collections.isLoading ? (
            <Skeleton className="aspect-[16/10] w-full rounded-panel" />
          ) : (
            hero && (
              <Reveal delay={260}>
                <Link to={`/art/${hero.slug}`} className="group block">
                  <figure className="overflow-hidden rounded-panel bg-surface-100">
                    <div className="aspect-[16/10] overflow-hidden">
                      <img
                        src={imageSource(hero.image)}
                        alt={hero.image?.alt || hero.title}
                        className="h-full w-full object-cover transition-transform duration-[1200ms] ease-gallery group-hover:scale-[1.03]"
                        fetchPriority="high"
                      />
                    </div>

                    <figcaption className="flex flex-wrap items-end justify-between gap-4 px-5 py-5 sm:px-7">
                      <div className="min-w-0">
                        <p className="eyebrow">Featured</p>
                        <h2 className="mt-1 truncate text-display-md">{hero.title}</h2>
                        <p className="mt-1 truncate text-[0.9375rem] text-muted">
                          {hero.artist?.displayName}
                          {hero.medium ? ` · ${hero.medium}` : ''}
                        </p>
                      </div>
                      <p className="shrink-0 text-[1.0625rem] font-medium text-ink">
                        {formatMoney(hero.priceMinor, hero.currency)}
                      </p>
                    </figcaption>
                  </figure>
                </Link>
              </Reveal>
            )
          )}
        </div>

        {/* ── Search, kept but demoted to a quiet row ── */}
        <div className="mx-auto max-w-[1024px] px-4 pb-16 sm:px-6">
          <button
            type="button"
            onClick={openSearch}
            className="group mx-auto flex w-full max-w-xl items-center gap-3 rounded-full border border-line bg-surface-0 px-5 py-3 text-left transition-colors hover:border-line-strong"
          >
            <Search
              className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-ink"
              aria-hidden="true"
            />
            <span className="flex-1 text-[0.9375rem] text-muted">
              Search by title, artist, medium or style
            </span>
            <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[0.7rem] text-muted sm:block">
              /
            </kbd>
          </button>
        </div>
      </section>

      {/* ──────────────────── Gallery invitation ──────────────────── */}
      <section className="border-y border-line/70 bg-surface-300/50">
        <div className="mx-auto max-w-[1500px] px-4 py-16 sm:px-6 lg:px-10">
          <Reveal>
            <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
              <div className="space-y-4">
                <p className="eyebrow">The signature experience</p>
                <h2 className="text-display-md">
                  A gallery you walk through, not a page you scroll past
                </h2>
                <p className="lede max-w-2xl">
                  Scroll to move forward down a lit corridor with work on both walls. Pieces approach,
                  pass and recede. Choose one and the camera steps up to it, the room falls away, and you
                  can read its story and buy it on the spot — then carry on walking from exactly where you
                  stopped.
                </p>
                <ul className="flex flex-wrap gap-x-8 gap-y-2 pt-1 text-[0.82rem] text-muted">
                  <li className="inline-flex items-center gap-2">
                    <Frame className="h-3.5 w-3.5 text-accent-300" aria-hidden="true" />
                    Real listings on every wall
                  </li>
                  <li className="inline-flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-accent-300" aria-hidden="true" />
                    Buy without leaving the room
                  </li>
                  <li className="inline-flex items-center gap-2">
                    <Palette className="h-3.5 w-3.5 text-accent-300" aria-hidden="true" />
                    A lighter view if you prefer
                  </li>
                </ul>
              </div>

              <Button variant="primary" size="lg" to="/gallery" className="shrink-0">
                Start walking
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ──────────────────── New arrivals ──────────────────── */}
      <Section
        eyebrow="Just hung"
        title="New arrivals"
        description="The most recent work to reach the marketplace."
        action={
          <Button variant="ghost" to="/shop?sort=newest">
            See everything
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      >
        <ArtworkRail artworks={collections.data?.newArrivals ?? []} isLoading={collections.isLoading} />
      </Section>

      {/* ──────────────────── Featured originals ──────────────────── */}
      {Boolean(collections.data?.featured?.length) && (
        <Section
          eyebrow="Curated"
          title="Featured this month"
          description="Chosen by our curators from across every artist on the platform."
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3 xl:grid-cols-4">
            {collections.data.featured.slice(0, 4).map((artwork, index) => (
              <Reveal key={artwork.id} delay={index * 70}>
                <ArtworkCard artwork={artwork} />
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* ──────────────────── Categories ──────────────────── */}
      <Section eyebrow="Browse" title="By category">
        {categories.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="aspect-[3/2]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(categories.data?.items ?? []).map((category, index) => (
              <Reveal key={category.id} delay={index * 60}>
                <Link
                  to={`/shop?category=${category.slug}`}
                  className="group relative flex aspect-[3/2] flex-col justify-end overflow-hidden rounded-2xl border border-line bg-surface-0 p-5 transition-colors hover:border-accent-300/40"
                >
                  <span className="absolute inset-0 bg-gradient-to-t from-surface-300 via-surface-300/40 to-transparent opacity-80" />
                  <span className="relative">
                    <span className="block font-display text-xl transition-colors group-hover:text-accent-300">
                      {category.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[0.7rem] uppercase tracking-wider text-muted">
                      {category.artworkCount} {category.artworkCount === 1 ? 'work' : 'works'}
                    </span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </Section>

      {/* ──────────────────── Artists ──────────────────── */}
      <Section
        eyebrow="The people behind it"
        title="Discover artists"
        description="Every piece here is sold by the artist who made it."
        action={
          <Button variant="ghost" to="/artists">
            All artists
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      >
        {artists.isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-56" />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(artists.data?.items ?? []).map((artist, index) => (
              <Reveal key={artist.id} delay={index * 70}>
                <Link
                  to={`/artists/${artist.slug}`}
                  className="group block rounded-2xl border border-line bg-surface-0/60 p-5 transition-colors hover:border-accent-300/40"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-surface-150">
                      {artist.avatarUrl && (
                        <img
                          src={imageSource({ url: artist.avatarUrl })}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg transition-colors group-hover:text-accent-300">
                        {artist.displayName}
                      </h3>
                      <p className="truncate text-[0.76rem] text-muted">{artist.location}</p>
                    </div>
                  </div>

                  {/* Three thumbnails, so an artist card shows work not words. */}
                  <div className="mt-4 grid grid-cols-3 gap-1.5">
                    {artist.preview.map((piece) => (
                      <div key={piece.id} className="aspect-square overflow-hidden rounded-sm bg-surface-150">
                        {piece.image && (
                          <img
                            src={imageSource({ url: piece.image })}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="mt-3.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted">
                    {artist.publishedArtworks} {artist.publishedArtworks === 1 ? 'work' : 'works'}
                  </p>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </Section>

      {/* ──────────────────── Studio ──────────────────── */}
      <section className="mx-auto max-w-[1500px] px-4 py-16 sm:px-6 lg:px-10">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-gallery-wall p-8 sm:p-12">
            <div className="max-w-2xl space-y-5">
              <p className="eyebrow">The Photo-to-Art studio</p>
              <h2 className="text-display-md">Turn your own photograph into a commission</h2>
              <p className="lede">
                Upload a photo, try it in four treatments, and send the result to an artist as the starting
                point for a commissioned piece. The previews are rendered in your browser — your photo
                stays on your device until you choose to send it.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Button variant="primary" to="/studio">
                  <Brush className="h-4 w-4" aria-hidden="true" />
                  Open the studio
                </Button>
                <Button variant="ghost" to="/shop?type=commission">
                  See commission work
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ──────────────────── Trending ──────────────────── */}
      {Boolean(collections.data?.trending?.length) && (
        <Section eyebrow="Moving fast" title="Most collected">
          <ArtworkRail artworks={collections.data.trending} />
        </Section>
      )}

      {/* ──────────────────── Artist call to action ──────────────────── */}
      <section className="mx-auto max-w-[1500px] px-4 pb-8 pt-10 sm:px-6 lg:px-10">
        <Reveal>
          <div className="flex flex-col items-center gap-6 rounded-3xl border border-accent-300/20 bg-accent-300/[0.04] px-6 py-12 text-center">
            <p className="eyebrow">For artists</p>
            <h2 className="text-display-md max-w-2xl">Sell your work on these walls</h2>
            <p className="lede max-w-xl">
              Open a storefront, upload your work, set your own prices and keep the majority of every
              sale. Your pieces hang in the virtual gallery alongside everyone else&apos;s.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="primary" size="lg" to="/become-an-artist">
                Become an artist
              </Button>
              <Button variant="ghost" size="lg" to="/artists">
                See who already sells here
              </Button>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
};

const Section = ({ eyebrow, title, description, action, children }) => (
  <section className="mx-auto max-w-[1500px] px-4 py-14 sm:px-6 lg:px-10">
    <Reveal>
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
        className="mb-9"
      />
    </Reveal>
    {children}
  </section>
);

export default HomePage;
