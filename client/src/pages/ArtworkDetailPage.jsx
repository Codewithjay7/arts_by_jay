import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight,
  Frame,
  Heart,
  MessageSquare,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import {
  Badge,
  Button,
  Divider,
  EmptyState,
  ErrorState,
  LoadingBlock,
  NoticeBanner,
  SectionHeader,
  Stars,
} from '../components/ui';
import { ArtworkGrid } from '../components/art/ArtworkGrid';
import { Reveal } from '../components/motion/Reveal';
import { ARTWORK_TYPE_LABELS, formatDate, formatDimensions, formatMoney } from '../lib/format';
import { imageSource } from '../lib/images';
import { useDocumentTitle } from '../lib/hooks';
import { useCart, useWishlist } from '../store/cart';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

export const ArtworkDetailPage = () => {
  const { slug } = useParams();
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const user = useAuth((state) => state.user);
  const toast = useUi((state) => state.toast);

  const addToCart = useCart((state) => state.add);
  const toggleWishlist = useWishlist((state) => state.toggle);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artwork', slug],
    queryFn: async () => {
      const { data: result } = await api.get(`/artworks/${slug}`);
      return result;
    },
    retry: false,
  });

  const artwork = data?.artwork;
  const cartPending = useCart((state) => state.isPending(artwork?.id));
  const isWishlisted = useWishlist((state) => (artwork ? state.has(artwork.id) : false));

  useDocumentTitle(artwork?.title);

  if (isLoading) return <LoadingBlock label="Bringing the work out" className="min-h-[70vh]" />;

  if (isError) {
    const notFound = error?.response?.status === 404;

    return (
      <div className="mx-auto max-w-3xl px-4 py-24">
        {notFound ? (
          <EmptyState
            icon={Frame}
            title="That piece is not available"
            message="It may have sold, or been taken down by the artist. The rest of the collection is still here."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" to="/shop">
                  Explore the collection
                </Button>
                <Button variant="secondary" to="/gallery">
                  Visit the gallery
                </Button>
              </div>
            }
          />
        ) : (
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        )}
      </div>
    );
  }

  const requireSignIn = (action) =>
    toast({ title: 'Sign in to continue', message: `You need an account to ${action}.`, tone: 'info' });

  const onAddToCart = () => {
    if (!user) return requireSignIn('add work to your cart');
    return addToCart(artwork, quantity);
  };

  const onWishlist = () => {
    if (!user) return requireSignIn('save work to a wishlist');
    return toggleWishlist(artwork);
  };

  const maxQuantity =
    artwork.type === 'original' ? 1 : artwork.shipping?.isDigitalDelivery ? 10 : Math.max(1, artwork.stock);

  const images = artwork.images?.length ? artwork.images : artwork.image ? [artwork.image] : [];

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      {/* ── Breadcrumb ── */}
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-[0.78rem] text-muted">
        <Link to="/shop" className="transition-colors hover:text-accent-300">
          Explore
        </Link>
        {artwork.category && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/shop?category=${artwork.category.slug}`} className="transition-colors hover:text-accent-300">
              {artwork.category.name}
            </Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="text-ink">{artwork.title}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* ──────────────── Images ──────────────── */}
        <div className="space-y-4">
          <div
            className={clsx(
              'art-frame',
              artwork.orientation === 'landscape'
                ? 'aspect-[4/3]'
                : artwork.orientation === 'square'
                  ? 'aspect-square'
                  : 'aspect-[4/5]',
            )}
          >
            {images[activeImage] ? (
              <img
                src={imageSource(images[activeImage])}
                alt={images[activeImage].alt || artwork.title}
                className="h-full w-full object-cover"
                fetchPriority="high"
              />
            ) : (
              <div className="grid h-full place-items-center bg-surface-150 text-sm text-muted">
                No image provided
              </div>
            )}

            {artwork.isSoldOut && (
              <div className="absolute inset-0 grid place-items-center bg-surface-300/60">
                <span className="rounded-full border border-ink/25 px-5 py-2 font-mono text-[0.75rem] uppercase tracking-[0.25em] text-ink">
                  Sold
                </span>
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex gap-3" role="tablist" aria-label="Artwork images">
              {images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  role="tab"
                  aria-selected={index === activeImage}
                  onClick={() => setActiveImage(index)}
                  className={clsx(
                    'h-20 w-16 overflow-hidden rounded-sm border-2 transition-colors',
                    index === activeImage ? 'border-accent-300' : 'border-transparent hover:border-surface-400',
                  )}
                >
                  <img
                    src={imageSource(image, { preferThumb: true })}
                    alt={`View ${index + 1} of ${artwork.title}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ──────────────── Details ──────────────── */}
        <div className="space-y-7">
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={artwork.type === 'original' ? 'accent' : 'neutral'}>
                {ARTWORK_TYPE_LABELS[artwork.type]}
              </Badge>
              {artwork.isFeatured && <Badge tone="positive">Featured</Badge>}
              {artwork.type === 'original' && !artwork.isSoldOut && <Badge tone="neutral">1 of 1</Badge>}
              {artwork.isSoldOut && <Badge tone="negative">Sold</Badge>}
            </div>

            <h1 className="text-display-lg leading-tight">{artwork.title}</h1>

            {artwork.artist && (
              <Link
                to={`/artists/${artwork.artist.slug}`}
                className="group inline-flex items-center gap-3 text-sm"
              >
                {artwork.artist.avatarUrl && (
                  <img
                    src={imageSource({ url: artwork.artist.avatarUrl })}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                )}
                <span className="text-muted">
                  by{' '}
                  <span className="text-ink transition-colors group-hover:text-accent-300">
                    {artwork.artist.displayName}
                  </span>
                  {artwork.artist.location && (
                    <span className="text-muted"> · {artwork.artist.location}</span>
                  )}
                </span>
              </Link>
            )}

            {artwork.rating?.count > 0 && <Stars value={artwork.rating.average} count={artwork.rating.count} />}
          </div>

          {/* ── Price ── */}
          <div className="flex items-end gap-4">
            <p className="font-mono text-4xl text-accent-300">
              {artwork.type === 'commission' && <span className="text-xl text-muted">from </span>}
              {formatMoney(artwork.priceMinor, artwork.currency)}
            </p>
            {artwork.compareAtPriceMinor > artwork.priceMinor && (
              <p className="pb-1.5 font-mono text-base text-muted line-through">
                {formatMoney(artwork.compareAtPriceMinor, artwork.currency)}
              </p>
            )}
          </div>

          {/* ── Availability ── */}
          {artwork.isSoldOut ? (
            <NoticeBanner tone="info" title="This piece has sold">
              It stays listed as part of the artist&apos;s record.
              {artwork.artist?.acceptsCommissions
                ? ' You can ask them about a commissioned piece in a similar vein.'
                : ''}
            </NoticeBanner>
          ) : artwork.type === 'commission' ? (
            <NoticeBanner tone="info" title="Available by commission">
              {artwork.artist?.commissionNote ||
                'This is arranged directly with the artist rather than bought from stock.'}
            </NoticeBanner>
          ) : artwork.type !== 'original' && artwork.stock <= 3 ? (
            <NoticeBanner tone="warning" title={`Only ${artwork.stock} left`}>
              This edition is nearly subscribed.
            </NoticeBanner>
          ) : null}

          {/* ── Buy actions ── */}
          <div className="space-y-3.5">
            {artwork.isPurchasable && maxQuantity > 1 && (
              <div className="flex items-center gap-3">
                <span className="text-[0.82rem] text-muted">Quantity</span>
                <div className="flex items-center rounded-full border border-line-strong">
                  <button
                    type="button"
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                    disabled={quantity <= 1}
                    className="grid h-9 w-9 place-items-center rounded-l-full text-muted transition-colors hover:text-ink disabled:opacity-40"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <span className="min-w-10 text-center font-mono text-sm text-ink">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
                    disabled={quantity >= maxQuantity}
                    className="grid h-9 w-9 place-items-center rounded-r-full text-muted transition-colors hover:text-ink disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5 sm:flex-row">
              {artwork.isPurchasable ? (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={onAddToCart}
                    loading={cartPending}
                    className="flex-1"
                  >
                    <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                    Add to cart
                  </Button>
                  <Button variant="outline" size="lg" to={`/checkout?buyNow=${artwork.id}`} className="flex-1">
                    Buy it now
                  </Button>
                </>
              ) : artwork.type === 'commission' ? (
                <Button
                  variant="primary"
                  size="lg"
                  to={`/studio?commission=${artwork.id}&artist=${artwork.artist?.slug ?? ''}`}
                  className="flex-1"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Enquire about this commission
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  to={`/studio?artist=${artwork.artist?.slug ?? ''}&artwork=${artwork.id}`}
                  className="flex-1"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Ask about a similar piece
                </Button>
              )}

              <Button variant="secondary" size="lg" onClick={onWishlist} className="sm:w-auto">
                <Heart className={clsx('h-4 w-4', isWishlisted && 'fill-current text-accent-300')} aria-hidden="true" />
                <span className="sm:hidden">{isWishlisted ? 'Saved' : 'Save'}</span>
                <span className="sr-only sm:not-sr-only sm:sr-only">
                  {isWishlisted ? 'Saved to wishlist' : 'Save to wishlist'}
                </span>
              </Button>
            </div>

            <Button variant="ghost" to="/gallery" className="w-full sm:w-auto">
              See it in the virtual gallery
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {/* ── The story ── */}
          {artwork.story && (
            <blockquote className="border-l-2 border-accent-300/40 pl-4">
              <p className="font-display text-lg italic leading-relaxed text-ink/90">
                “{artwork.story}”
              </p>
              <footer className="mt-2 text-[0.78rem] text-muted">
                — {artwork.artist?.displayName}, on this work
              </footer>
            </blockquote>
          )}

          {artwork.description && (
            <div className="space-y-2">
              <h2 className="eyebrow">About this work</h2>
              <p className="whitespace-pre-line text-[0.92rem] leading-relaxed text-muted">
                {artwork.description}
              </p>
            </div>
          )}

          {/* ── Specification ── */}
          <div className="space-y-3">
            <h2 className="eyebrow">Details</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 text-[0.85rem]">
              <Spec label="Medium" value={artwork.medium} />
              <Spec label="Dimensions" value={formatDimensions(artwork.dimensions)} />
              <Spec label="Year" value={artwork.year} />
              <Spec label="Style" value={artwork.style} />
              <Spec label="Framed" value={artwork.isFramed ? 'Yes, ready to hang' : 'Unframed'} />
              <Spec label="Type" value={ARTWORK_TYPE_LABELS[artwork.type]} />
              {artwork.type !== 'original' && !artwork.shipping?.isDigitalDelivery && (
                <Spec label="Available" value={`${artwork.stock} in this edition`} />
              )}
              <Spec label="Listed" value={formatDate(artwork.publishedAt)} />
            </dl>
          </div>

          {/* ── Shipping ── */}
          <div className="space-y-3 rounded-2xl border border-line bg-surface-0/50 p-5">
            <h2 className="eyebrow">Delivery</h2>
            <ul className="space-y-2.5 text-[0.84rem] text-muted">
              {artwork.shipping?.isDigitalDelivery ? (
                <li className="flex items-start gap-2.5">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
                  Delivered as a download once your payment is confirmed.
                </li>
              ) : (
                <>
                  <li className="flex items-start gap-2.5">
                    <Truck className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
                    {artwork.shipping?.flatRateMinor > 0
                      ? `Shipping ${formatMoney(artwork.shipping.flatRateMinor, artwork.currency)}`
                      : 'Free shipping'}
                    {artwork.shipping?.shipsFrom ? ` · ships from ${artwork.shipping.shipsFrom}` : ''}
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
                    The studio prepares this in about {artwork.shipping?.processingDays ?? 3} working days,
                    then dispatches by insured courier.
                  </li>
                </>
              )}
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
                Payment is taken securely by the gateway and verified on our server before any order is
                confirmed.
              </li>
            </ul>
          </div>

          {/* ── The artist ── */}
          {artwork.artist?.bio && (
            <div className="space-y-3 rounded-2xl border border-line bg-surface-0/50 p-5">
              <h2 className="eyebrow">About the artist</h2>
              <p className="text-[0.86rem] leading-relaxed text-muted">{artwork.artist.bio}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" size="sm" to={`/artists/${artwork.artist.slug}`}>
                  Visit the storefront
                </Button>
                {artwork.artist.acceptsCommissions && (
                  <Button variant="ghost" size="sm" to={`/studio?artist=${artwork.artist.slug}`}>
                    Commission a piece
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ──────────────── Reviews ──────────────── */}
      {data.reviews?.length > 0 && (
        <>
          <Divider />
          <section aria-labelledby="reviews-heading">
            <SectionHeader
              eyebrow="From collectors"
              title="Reviews"
              description="Left by verified buyers once their order was delivered."
              className="mb-8"
            />
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {data.reviews.map((review) => (
                <Reveal key={review.id}>
                  <article className="panel space-y-3 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <Stars value={review.rating} />
                      {review.isVerifiedPurchase && <Badge tone="positive">Verified buyer</Badge>}
                    </div>
                    {review.title && <h3 className="font-display text-lg">{review.title}</h3>}
                    {review.body && <p className="text-[0.86rem] leading-relaxed text-muted">{review.body}</p>}
                    <footer className="text-[0.75rem] text-muted">
                      {review.author.name} · {formatDate(review.createdAt)}
                    </footer>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ──────────────── Related ──────────────── */}
      {data.related?.length > 0 && (
        <>
          <Divider />
          <section aria-labelledby="related-heading">
            <SectionHeader
              eyebrow="You might also like"
              title="Related work"
              description="From the same artist, or the same part of the collection."
              className="mb-8"
            />
            <ArtworkGrid artworks={data.related.slice(0, 8)} columns="tight" />
          </section>
        </>
      )}
    </div>
  );
};

const Spec = ({ label, value }) => {
  if (!value) return null;

  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-ink">{value}</dd>
    </div>
  );
};

export default ArtworkDetailPage;
