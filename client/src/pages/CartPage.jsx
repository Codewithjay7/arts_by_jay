import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button, EmptyState, LoadingBlock, NoticeBanner } from '../components/ui';
import { formatMoney } from '../lib/format';
import { imageSource } from '../lib/images';
import { useCart } from '../store/cart';
import { useDocumentTitle } from '../lib/hooks';

export const CartPage = () => {
  useDocumentTitle('Your cart');

  const { items, totals, issues, status, setQuantity, remove, clear, isPending } = useCart();

  const blocking = issues.filter((issue) =>
    ['sold_out', 'unavailable', 'removed', 'commission_only'].includes(issue.kind),
  );

  if (status === 'loading' || status === 'idle') {
    return <LoadingBlock label="Loading your cart" className="min-h-[60vh]" />;
  }

  if (!items.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          message="Browse the collection, or walk through the virtual gallery and pick something off the wall."
          action={
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button variant="primary" to="/shop">
                Explore artwork
              </Button>
              <Button variant="outline" to="/gallery">
                Enter the gallery
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="mb-9 space-y-2">
        <p className="eyebrow">Your selection</p>
        <h1 className="text-display-lg">Cart</h1>
        <p className="lede">
          {totals.itemCount} {totals.itemCount === 1 ? 'piece' : 'pieces'} held for you. Prices and
          availability are checked again before you pay.
        </p>
      </header>

      {issues.length > 0 && (
        <div className="mb-8 space-y-2.5">
          {issues.map((issue, index) => (
            <NoticeBanner
              key={`${issue.kind}-${index}`}
              tone={blocking.includes(issue) ? 'warning' : 'info'}
              title={
                issue.kind === 'price_changed'
                  ? 'A price changed'
                  : issue.kind === 'quantity_reduced'
                    ? 'A quantity was reduced'
                    : 'An item needs attention'
              }
            >
              {issue.message}
              {issue.kind === 'price_changed' && issue.fromMinor != null && (
                <span className="ml-1 font-mono">
                  ({formatMoney(issue.fromMinor, totals.currency)} → {formatMoney(issue.toMinor, totals.currency)})
                </span>
              )}
            </NoticeBanner>
          ))}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
        {/* ── Line items ── */}
        <div>
          <ul className="divide-y divide-charcoal-700 border-y border-charcoal-700">
            {items.map(({ artwork, quantity, unitPriceMinor, lineTotalMinor, shippingMinor, isDigital }) => {
              const pending = isPending(artwork.id);
              const atLimit = artwork.type === 'original' || (artwork.stock > 0 && quantity >= artwork.stock);

              return (
                <li key={artwork.id} className="flex flex-col gap-5 py-6 sm:flex-row">
                  <Link to={`/art/${artwork.slug}`} className="shrink-0">
                    <div className="art-frame h-32 w-26 sm:h-40 sm:w-32">
                      {artwork.image && (
                        <img
                          src={imageSource(artwork.image, { preferThumb: true })}
                          alt={artwork.image.alt || artwork.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
                    <div className="space-y-1.5">
                      <Link
                        to={`/art/${artwork.slug}`}
                        className="block font-display text-xl transition-colors hover:text-accent-300"
                      >
                        {artwork.title}
                      </Link>
                      <p className="text-[0.84rem] text-muted">
                        {artwork.artist?.displayName}
                        {artwork.medium ? ` · ${artwork.medium}` : ''}
                      </p>
                      <p className="font-mono text-[0.78rem] text-muted">
                        {formatMoney(unitPriceMinor, artwork.currency)} each
                        {isDigital
                          ? ' · digital download'
                          : shippingMinor > 0
                            ? ` · ${formatMoney(shippingMinor, artwork.currency)} shipping`
                            : ' · free shipping'}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center rounded-full border border-charcoal-600">
                        <button
                          type="button"
                          onClick={() => setQuantity(artwork.id, quantity - 1)}
                          disabled={pending}
                          className="grid h-9 w-9 place-items-center rounded-l-full text-muted transition-colors hover:text-parchment disabled:opacity-40"
                          aria-label={`Decrease quantity of ${artwork.title}`}
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="min-w-10 text-center font-mono text-sm text-parchment" aria-live="polite">
                          {pending ? '…' : quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity(artwork.id, quantity + 1)}
                          disabled={pending || atLimit}
                          className="grid h-9 w-9 place-items-center rounded-r-full text-muted transition-colors hover:text-parchment disabled:opacity-40"
                          aria-label={`Increase quantity of ${artwork.title}`}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      {artwork.type === 'original' && (
                        <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted">
                          One of one
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => remove(artwork.id)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 text-[0.8rem] text-muted transition-colors hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  </div>

                  <p className="shrink-0 font-mono text-lg text-parchment sm:text-right">
                    {formatMoney(lineTotalMinor, artwork.currency)}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <Button variant="ghost" to="/shop">
              Keep exploring
            </Button>
            <button
              type="button"
              onClick={clear}
              className="text-[0.8rem] text-muted underline-offset-4 transition-colors hover:text-red-300 hover:underline"
            >
              Empty the cart
            </button>
          </div>
        </div>

        {/* ── Summary ── */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="panel space-y-5 p-6">
            <h2 className="font-display text-xl">Order summary</h2>

            <dl className="space-y-2.5 text-[0.88rem]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-parchment">{formatMoney(totals.subtotalMinor, totals.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Shipping</dt>
                <dd className="text-parchment">
                  {totals.shippingTotalMinor > 0
                    ? formatMoney(totals.shippingTotalMinor, totals.currency)
                    : 'Free'}
                </dd>
              </div>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between text-accent-300">
                  <dt>Discount</dt>
                  <dd>−{formatMoney(totals.discountMinor, totals.currency)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-charcoal-700 pt-3">
                <dt className="text-base text-parchment">Total</dt>
                <dd className="font-mono text-2xl text-accent-300">
                  {formatMoney(totals.totalMinor, totals.currency)}
                </dd>
              </div>
            </dl>

            {blocking.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3.5 py-2.5 text-[0.8rem] text-amber-100">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Resolve the highlighted items before checking out.
              </div>
            )}

            <Button
              variant="primary"
              size="lg"
              to="/checkout"
              className="w-full"
              disabled={blocking.length > 0}
            >
              Proceed to checkout
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>

            <p className="text-[0.72rem] leading-relaxed text-muted">
              Payment is taken by the configured gateway. Your card details never reach this server, and
              no order is confirmed until the payment is verified server-side.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CartPage;
