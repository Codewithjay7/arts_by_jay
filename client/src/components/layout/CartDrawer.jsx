import { Link } from 'react-router-dom';
import { AlertCircle, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button, Drawer, EmptyState, Spinner } from '../ui';
import { formatMoney } from '../../lib/format';
import { useCart } from '../../store/cart';
import { useUi } from '../../store/ui';
import { useAuth } from '../../store/auth';

export const CartDrawer = () => {
  const isOpen = useUi((state) => state.isCartOpen);
  const closeCart = useUi((state) => state.closeCart);
  const user = useAuth((state) => state.user);

  const { items, totals, issues, status, setQuantity, remove, isPending } = useCart();

  const blockingIssues = issues.filter((issue) =>
    ['sold_out', 'unavailable', 'removed', 'commission_only'].includes(issue.kind),
  );

  return (
    <Drawer
      open={isOpen}
      onClose={closeCart}
      title={`Your cart${totals.itemCount ? ` (${totals.itemCount})` : ''}`}
      footer={
        items.length > 0 && (
          <div className="space-y-3">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-parchment">{formatMoney(totals.subtotalMinor, totals.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Shipping</dt>
                <dd className="text-parchment">
                  {totals.shippingTotalMinor > 0 ? formatMoney(totals.shippingTotalMinor, totals.currency) : 'Free'}
                </dd>
              </div>
              <div className="flex justify-between border-t border-charcoal-700 pt-2 text-base">
                <dt className="text-parchment">Total</dt>
                <dd className="font-mono text-lime-300">{formatMoney(totals.totalMinor, totals.currency)}</dd>
              </div>
            </dl>

            <p className="text-[0.72rem] leading-relaxed text-muted">
              Prices and availability are confirmed again at checkout.
            </p>

            <Button
              variant="primary"
              to="/checkout"
              onClick={closeCart}
              className="w-full"
              disabled={blockingIssues.length > 0}
            >
              {blockingIssues.length > 0 ? 'Resolve the issues above' : 'Go to checkout'}
            </Button>

            <Button variant="ghost" to="/cart" onClick={closeCart} className="w-full">
              View full cart
            </Button>
          </div>
        )
      }
    >
      {!user ? (
        <EmptyState
          icon={ShoppingBag}
          title="Sign in to use your cart"
          message="Your cart is saved to your account, so it follows you between devices."
          action={
            <Button variant="primary" to="/login" onClick={closeCart}>
              Sign in
            </Button>
          }
        />
      ) : status === 'loading' ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading your cart" />
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          message="Browse the collection, or walk through the virtual gallery to find something."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" to="/shop" onClick={closeCart}>
                Explore art
              </Button>
              <Button variant="outline" to="/gallery" onClick={closeCart}>
                Enter the gallery
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Issues the server reported while re-pricing. */}
          {issues.length > 0 && (
            <ul className="space-y-2">
              {issues.map((issue, index) => (
                <li
                  key={`${issue.kind}-${index}`}
                  className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[0.78rem] leading-relaxed text-amber-100"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          <ul className="divide-y divide-charcoal-700">
            {items.map(({ artwork, quantity, unitPriceMinor, lineTotalMinor }) => {
              const pending = isPending(artwork.id);
              const atStockLimit = !artwork.isPurchasable || (artwork.stock > 0 && quantity >= artwork.stock);

              return (
                <li key={artwork.id} className="flex gap-3 py-4">
                  <Link to={`/art/${artwork.slug}`} onClick={closeCart} className="shrink-0">
                    <div className="h-20 w-16 overflow-hidden rounded-sm bg-charcoal-800">
                      {artwork.image && (
                        <img
                          src={artwork.image.thumbUrl || artwork.image.url}
                          alt={artwork.image.alt || artwork.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                  </Link>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Link
                      to={`/art/${artwork.slug}`}
                      onClick={closeCart}
                      className="block truncate text-sm text-parchment transition-colors hover:text-lime-300"
                    >
                      {artwork.title}
                    </Link>
                    <p className="truncate text-[0.75rem] text-muted">{artwork.artist?.displayName}</p>
                    <p className="font-mono text-[0.75rem] text-muted">
                      {formatMoney(unitPriceMinor, artwork.currency)} each
                    </p>

                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="flex items-center rounded-full border border-charcoal-600">
                        <button
                          type="button"
                          onClick={() => setQuantity(artwork.id, quantity - 1)}
                          disabled={pending}
                          aria-label={`Decrease quantity of ${artwork.title}`}
                          className="grid h-7 w-7 place-items-center rounded-l-full text-muted transition-colors hover:text-parchment disabled:opacity-40"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <span
                          className="min-w-7 text-center font-mono text-[0.78rem] text-parchment"
                          aria-live="polite"
                        >
                          {pending ? '…' : quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity(artwork.id, quantity + 1)}
                          disabled={pending || atStockLimit || artwork.type === 'original'}
                          aria-label={`Increase quantity of ${artwork.title}`}
                          className="grid h-7 w-7 place-items-center rounded-r-full text-muted transition-colors hover:text-parchment disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => remove(artwork.id)}
                        disabled={pending}
                        aria-label={`Remove ${artwork.title} from cart`}
                        className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <p className="shrink-0 font-mono text-[0.82rem] text-parchment">
                    {formatMoney(lineTotalMinor, artwork.currency)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Drawer>
  );
};
