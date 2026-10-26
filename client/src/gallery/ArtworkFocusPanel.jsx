import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Heart, MessageSquare, ShoppingBag, X } from 'lucide-react';
import { getGalleryArtwork } from '../lib/data/artworks';
import { Badge, Button, LoadingBlock, NoticeBanner, Spinner } from '../components/ui';
import { ARTWORK_TYPE_LABELS, formatDimensions, formatMoney } from '../lib/format';
import { imageSource } from '../lib/images';
import { useCart, useWishlist } from '../store/cart';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

/**
 * The cinematic detail view that opens over the focused painting.
 *
 * Everything shown here is the live product record for the same listing the
 * shop sells — fetched by id from /api/gallery/artworks/:id — so price,
 * availability and the add-to-cart action are the real ones, not a copy.
 */
export const ArtworkFocusPanel = ({ artworkId, onClose, onSelectAlternative }) => {
  const panelRef = useRef(null);
  const user = useAuth((state) => state.user);
  const toast = useUi((state) => state.toast);

  const addToCart = useCart((state) => state.add);
  const cartPending = useCart((state) => state.isPending(artworkId));
  const toggleWishlist = useWishlist((state) => state.toggle);
  const isWishlisted = useWishlist((state) => state.has(artworkId));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['gallery-artwork', artworkId],
    queryFn: () => getGalleryArtwork(artworkId),
    enabled: Boolean(artworkId),
    retry: false,
  });

  const artwork = data?.artwork;

  // A piece can sell while someone is mid-corridor; the API returns 404 with
  // alternatives, which we surface rather than showing a dead panel.
  const alternatives = error?.alternatives ?? [];
  const isGone = error?.code === 'ARTWORK_GONE';

  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    // Move focus into the panel so a keyboard visitor lands inside it.
    const timer = setTimeout(() => panelRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [artworkId]);

  const requireSignIn = (action) =>
    toast({ title: 'Sign in to continue', message: `You need an account to ${action}.`, tone: 'info' });

  const onAddToCart = () => {
    if (!user) return requireSignIn('add work to your cart');
    return addToCart(artwork);
  };

  const onWishlist = () => {
    if (!user) return requireSignIn('save work to a wishlist');
    return toggleWishlist(artwork);
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={artwork ? `${artwork.title}, details` : 'Artwork details'}
      className={clsx(
        'pointer-events-auto absolute inset-x-0 bottom-0 z-30 max-h-[82vh] overflow-y-auto',
        'border-t border-line/80 bg-surface-300/92 backdrop-blur-2xl',
        'animate-fade-up focus:outline-none',
        'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[clamp(26rem,36vw,34rem)] md:border-l md:border-t-0',
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-surface-100/80 text-ink transition-colors hover:border-accent-300/60 hover:text-accent-300"
        aria-label="Close and return to the gallery"
      >
        <X className="h-4.5 w-4.5" aria-hidden="true" />
      </button>

      {isLoading && <LoadingBlock label="Approaching the work" className="min-h-[24rem]" />}

      {isError && (
        <div className="space-y-5 p-6 pt-16">
          <div className="space-y-2">
            <p className="eyebrow">No longer on display</p>
            <h2 className="text-display-md">
              {isGone ? 'This piece has left the wall' : 'That did not load'}
            </h2>
            <p className="lede">
              {isGone
                ? 'It has either sold or been taken down since you started walking. Here is what is hanging nearby.'
                : error?.message}
            </p>
          </div>

          {alternatives.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {alternatives.map((alternative) => (
                <button
                  key={alternative.id}
                  type="button"
                  onClick={() => onSelectAlternative?.(alternative)}
                  className="group text-left"
                >
                  <div className="art-frame aspect-[4/5]">
                    {alternative.image && (
                      <img
                        src={imageSource(alternative.image, { preferThumb: true })}
                        alt={alternative.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm text-ink group-hover:text-accent-300">
                    {alternative.title}
                  </p>
                  <p className="font-mono text-[0.75rem] text-muted">
                    {formatMoney(alternative.priceMinor, alternative.currency)}
                  </p>
                </button>
              ))}
            </div>
          )}

          <Button variant="secondary" onClick={onClose} className="w-full">
            Back to the gallery
          </Button>
        </div>
      )}

      {artwork && (
        <div className="p-6 pt-16 md:p-7 md:pt-16">
          {/* ── Title block, set like a catalogue entry ── */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={artwork.type === 'original' ? 'accent' : 'neutral'}>
                {ARTWORK_TYPE_LABELS[artwork.type]}
              </Badge>
              {artwork.isSoldOut && <Badge tone="negative">Sold</Badge>}
              {artwork.isFeatured && <Badge tone="positive">Featured</Badge>}
              {artwork.type === 'original' && !artwork.isSoldOut && <Badge tone="neutral">1 of 1</Badge>}
            </div>

            <h2 className="text-display-md leading-tight">{artwork.title}</h2>

            {artwork.artist && (
              <Link
                to={`/artists/${artwork.artist.slug}`}
                className="group inline-flex items-center gap-2.5 text-sm text-muted transition-colors hover:text-accent-300"
              >
                {artwork.artist.avatarUrl && (
                  <img
                    src={imageSource({ url: artwork.artist.avatarUrl })}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                )}
                <span>
                  by <span className="text-ink group-hover:text-accent-300">{artwork.artist.displayName}</span>
                </span>
              </Link>
            )}
          </div>

          {/* ── The story behind the work ── */}
          {artwork.story && (
            <blockquote className="mt-6 border-l-2 border-accent-300/40 pl-4">
              <p className="font-display text-base italic leading-relaxed text-ink/90">
                “{artwork.story}”
              </p>
            </blockquote>
          )}

          {artwork.description && (
            <p className="mt-5 text-[0.9rem] leading-relaxed text-muted">{artwork.description}</p>
          )}

          {/* ── Specification table ── */}
          <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-3.5 border-y border-line py-5 text-[0.82rem]">
            {artwork.medium && (
              <div>
                <dt className="eyebrow">Medium</dt>
                <dd className="mt-0.5 text-ink">{artwork.medium}</dd>
              </div>
            )}
            {formatDimensions(artwork.dimensions) && (
              <div>
                <dt className="eyebrow">Dimensions</dt>
                <dd className="mt-0.5 text-ink">{formatDimensions(artwork.dimensions)}</dd>
              </div>
            )}
            {artwork.year && (
              <div>
                <dt className="eyebrow">Year</dt>
                <dd className="mt-0.5 text-ink">{artwork.year}</dd>
              </div>
            )}
            {artwork.style && (
              <div>
                <dt className="eyebrow">Style</dt>
                <dd className="mt-0.5 text-ink">{artwork.style}</dd>
              </div>
            )}
            <div>
              <dt className="eyebrow">Availability</dt>
              <dd className="mt-0.5 text-ink">
                {artwork.isSoldOut
                  ? 'Sold'
                  : artwork.type === 'commission'
                    ? 'By commission'
                    : artwork.type === 'original'
                      ? 'Available — one only'
                      : `${artwork.stock} available`}
              </dd>
            </div>
            {artwork.shipping?.shipsFrom && (
              <div>
                <dt className="eyebrow">Ships from</dt>
                <dd className="mt-0.5 text-ink">{artwork.shipping.shipsFrom}</dd>
              </div>
            )}
          </dl>

          {/* ── Price and actions ── */}
          <div className="mt-6 space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">{artwork.type === 'commission' ? 'Commissions from' : 'Price'}</p>
                <p className="mt-1 font-mono text-3xl text-accent-300">
                  {formatMoney(artwork.priceMinor, artwork.currency)}
                </p>
              </div>
              {artwork.compareAtPriceMinor > artwork.priceMinor && (
                <p className="font-mono text-sm text-muted line-through">
                  {formatMoney(artwork.compareAtPriceMinor, artwork.currency)}
                </p>
              )}
            </div>

            {artwork.isSoldOut ? (
              <NoticeBanner tone="info" title="This piece has sold">
                It is kept on display as part of the artist&apos;s record. You can ask about a similar
                commission, or follow the artist for new work.
              </NoticeBanner>
            ) : null}

            <div className="flex flex-col gap-2.5">
              {artwork.isPurchasable && (
                <>
                  <Button variant="primary" onClick={onAddToCart} loading={cartPending} className="w-full">
                    <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                    Add to cart
                  </Button>
                  <Button variant="outline" to={`/checkout?buyNow=${artwork.id}`} className="w-full">
                    Buy it now
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </>
              )}

              {artwork.type === 'commission' && (
                <Button
                  variant="primary"
                  to={`/studio?commission=${artwork.id}&artist=${artwork.artist?.slug ?? ''}`}
                  className="w-full"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Discuss this commission
                </Button>
              )}

              <div className="flex gap-2.5">
                <Button variant="secondary" onClick={onWishlist} className="flex-1">
                  <Heart className={clsx('h-4 w-4', isWishlisted && 'fill-current text-accent-300')} aria-hidden="true" />
                  {isWishlisted ? 'Saved' : 'Save'}
                </Button>
                <Button variant="secondary" to={`/art/${artwork.slug}`} className="flex-1">
                  Full details
                </Button>
              </div>

              {(artwork.isSoldOut || artwork.artist?.acceptsCommissions) && (
                <Button
                  variant="ghost"
                  to={`/studio?artist=${artwork.artist?.slug ?? ''}&artwork=${artwork.id}`}
                  className="w-full"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Ask the artist about a similar piece
                </Button>
              )}
            </div>

            <p className="pt-1 text-center text-[0.72rem] text-muted">
              Closing this returns you to the same spot in the gallery.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export const FocusPanelFallback = () => (
  <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center border-t border-line bg-surface-300/92 py-16 backdrop-blur-xl md:inset-y-0 md:left-auto md:right-0 md:w-[30rem] md:border-l md:border-t-0">
    <Spinner label="Loading artwork" />
  </div>
);
