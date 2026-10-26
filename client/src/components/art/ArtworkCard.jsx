import { memo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Heart, ShoppingBag } from 'lucide-react';
import { Badge, Skeleton } from '../ui';
import { ARTWORK_TYPE_LABELS, formatDimensions, formatMoney } from '../../lib/format';
import { useCart, useWishlist } from '../../store/cart';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';

/** Keeps the grid from reflowing as images load. */
const ASPECT = {
  portrait: 'aspect-[4/5]',
  landscape: 'aspect-[4/3]',
  square: 'aspect-square',
};

export const ArtworkCard = memo(function ArtworkCard({ artwork, priority = false, className }) {
  const addToCart = useCart((state) => state.add);
  const cartPending = useCart((state) => state.isPending(artwork.id));
  const toggleWishlist = useWishlist((state) => state.toggle);
  const isWishlisted = useWishlist((state) => state.has(artwork.id));
  const isAuthenticated = useAuth((state) => Boolean(state.user));
  const toast = useUi((state) => state.toast);

  const requireSignIn = (action) => {
    toast({
      title: 'Sign in to continue',
      message: `You need an account to ${action}.`,
      tone: 'info',
    });
  };

  const onWishlist = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isAuthenticated) {
      requireSignIn('save work to a wishlist');
      return;
    }
    toggleWishlist(artwork);
  };

  const onAddToCart = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isAuthenticated) {
      requireSignIn('add work to your cart');
      return;
    }
    addToCart(artwork);
  };

  const isCommission = artwork.type === 'commission';

  return (
    <article className={clsx('group relative', className)}>
      <Link
        to={`/art/${artwork.slug}`}
        className="block focus-visible:outline-none"
        aria-label={`${artwork.title} by ${artwork.artist?.displayName ?? 'unknown artist'}`}
      >
        {/* ── Framed image ── */}
        <div
          className={clsx(
            'art-frame transition-transform duration-500 ease-gallery',
            'group-hover:-translate-y-1 group-focus-visible:-translate-y-1',
            ASPECT[artwork.orientation] ?? ASPECT.portrait,
          )}
        >
          {artwork.image ? (
            <img
              src={artwork.image.thumbUrl || artwork.image.url}
              alt={artwork.image.alt || artwork.title}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-700 ease-gallery group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-surface-150 text-xs text-muted">
              No image
            </div>
          )}

          {/* ── Status overlay ── */}
          {artwork.isSoldOut && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-surface-300/65 backdrop-blur-[1px]">
              <span className="rounded-full border border-ink/25 px-4 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink">
                Sold
              </span>
            </div>
          )}

          {/* ── Corner badges ── */}
          <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
            {artwork.isFeatured && <Badge tone="accent">Featured</Badge>}
            {isCommission && <Badge tone="info">Commission</Badge>}
            {!isCommission && artwork.type !== 'original' && (
              <Badge tone="neutral">{ARTWORK_TYPE_LABELS[artwork.type]}</Badge>
            )}
            {artwork.type === 'original' && !artwork.isSoldOut && <Badge tone="neutral">1 of 1</Badge>}
          </div>

          {/* ── Quick actions ──
               Always in the DOM for keyboard and touch; only the opacity is
               hover-dependent, so they are never unreachable. */}
          <div
            className={clsx(
              'absolute right-3 top-3 z-10 flex flex-col gap-2',
              'opacity-100 transition-opacity duration-300 md:opacity-0',
              'md:group-hover:opacity-100 md:group-focus-within:opacity-100',
            )}
          >
            <button
              type="button"
              onClick={onWishlist}
              aria-pressed={isWishlisted}
              aria-label={isWishlisted ? `Remove ${artwork.title} from wishlist` : `Save ${artwork.title} to wishlist`}
              className={clsx(
                'grid h-9 w-9 place-items-center rounded-full border backdrop-blur transition-all',
                isWishlisted
                  ? 'border-accent-300 bg-accent-300 text-white'
                  : 'border-ink/20 bg-surface-300/70 text-ink hover:border-accent-300/60 hover:text-accent-300',
              )}
            >
              <Heart className={clsx('h-4 w-4', isWishlisted && 'fill-current')} aria-hidden="true" />
            </button>

            {artwork.isPurchasable && (
              <button
                type="button"
                onClick={onAddToCart}
                disabled={cartPending}
                aria-label={`Add ${artwork.title} to cart`}
                className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 bg-surface-300/70 text-ink backdrop-blur transition-all hover:border-accent-300/60 hover:text-accent-300 disabled:opacity-50"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* ── Caption, set like a gallery label ── */}
        <div className="mt-3.5 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-display text-lg leading-snug text-ink transition-colors group-hover:text-accent-300">
              {artwork.title}
            </h3>
            <p className="shrink-0 font-mono text-[0.8rem] text-accent-300">
              {isCommission ? 'From ' : ''}
              {formatMoney(artwork.priceMinor, artwork.currency)}
            </p>
          </div>

          <p className="truncate text-[0.8rem] text-muted">
            {artwork.artist?.displayName ?? 'Unknown artist'}
          </p>

          <p className="truncate font-mono text-[0.7rem] uppercase tracking-wider text-muted/70">
            {[artwork.medium, formatDimensions(artwork.dimensions)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </Link>
    </article>
  );
});

export const ArtworkCardSkeleton = ({ orientation = 'portrait' }) => (
  <div className="space-y-3.5">
    <Skeleton className={clsx('w-full rounded-sm', ASPECT[orientation])} />
    <div className="space-y-2">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  </div>
);
