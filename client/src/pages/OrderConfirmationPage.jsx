import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Mail, Package, Truck } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { Badge, Button, ErrorState, LoadingBlock, NoticeBanner } from '../components/ui';
import { formatDate, formatMoney, statusLabel, statusTone } from '../lib/format';
import { imageSource } from '../lib/images';
import { useDocumentTitle } from '../lib/hooks';
import { Reveal } from '../components/motion/Reveal';

export const OrderConfirmationPage = () => {
  const { orderNumber } = useParams();
  useDocumentTitle(`Order ${orderNumber}`);

  // Fetched rather than read from navigation state, so a refresh or a shared
  // link shows the real, current order.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: async () => {
      const { data: result } = await api.get(`/orders/${orderNumber}`);
      return result;
    },
    retry: false,
  });

  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: async () => {
      const { data: result } = await api.get('/capabilities');
      return result;
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) return <LoadingBlock label="Confirming your order" className="min-h-[60vh]" />;

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <ErrorState
          title="We could not find that order"
          message={errorMessage(error, 'That order number does not match anything in your account.')}
          onRetry={refetch}
        />
        <div className="mt-6 text-center">
          <Button variant="secondary" to="/account/orders">
            See all my orders
          </Button>
        </div>
      </div>
    );
  }

  const { order } = data;
  const isPaid = ['paid', 'processing', 'shipped', 'delivered'].includes(order.status);
  const emailConfigured = capabilities.data?.emailDelivery === true;

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <Reveal>
        <header className="space-y-5 text-center">
          <span
            className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${
              isPaid ? 'bg-accent-300 text-white' : 'bg-surface-150 text-muted'
            }`}
          >
            {isPaid ? <Check className="h-7 w-7" aria-hidden="true" /> : <Package className="h-7 w-7" aria-hidden="true" />}
          </span>

          <div className="space-y-2">
            <p className="eyebrow">{isPaid ? 'Payment verified' : statusLabel(order.status)}</p>
            <h1 className="text-display-lg">
              {isPaid ? 'Thank you — your order is confirmed' : 'Your order is not yet complete'}
            </h1>
            <p className="lede mx-auto max-w-xl">
              Order <span className="font-mono text-ink">{order.orderNumber}</span>
              {' · '}
              {formatDate(order.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
            {order.isSimulatedPayment && <Badge tone="warning">Simulated payment</Badge>}
          </div>
        </header>
      </Reveal>

      {/* Never let a simulated sale look like a real one. */}
      {order.isSimulatedPayment && (
        <NoticeBanner tone="warning" title="This order used the simulated gateway" className="mt-8">
          No card was taken and no money moved. The order, stock change and artist earnings are all real
          records in the database, but the payment was simulated by the development gateway. Configure
          Razorpay or Stripe for live payments.
        </NoticeBanner>
      )}

      {!isPaid && order.status === 'pending_payment' && (
        <NoticeBanner tone="warning" title="Payment has not been completed" className="mt-8">
          Nothing has been charged. You can start the checkout again from your cart, and this order will be
          replaced rather than duplicated.
        </NoticeBanner>
      )}

      {/* Honest about email: no claim that a receipt was sent when it wasn't. */}
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-surface-0/60 px-4 py-3.5">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <p className="text-[0.84rem] leading-relaxed text-muted">
          {emailConfigured
            ? `A receipt is on its way to ${order.shippingAddress?.fullName ? 'you' : 'your email address'}.`
            : 'Email delivery is not configured on this server, so no receipt email has been sent. This page and your account are the record of the order — you can return to it at any time.'}
        </p>
      </div>

      {/* ── Items ── */}
      <section className="mt-10" aria-labelledby="items-heading">
        <h2 id="items-heading" className="eyebrow mb-4">
          What you bought
        </h2>

        <ul className="divide-y divide-line border-y border-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-4 py-5">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-sm bg-surface-150">
                {item.imageUrl && (
                  <img
                    src={imageSource({ url: item.imageUrl })}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                <Link
                  to={`/art/${item.slug}`}
                  className="block font-display text-lg transition-colors hover:text-accent-300"
                >
                  {item.title}
                </Link>
                <p className="text-[0.8rem] text-muted">
                  {item.medium}
                  {item.quantity > 1 ? ` · quantity ${item.quantity}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Badge tone={statusTone(item.fulfilmentStatus)}>{statusLabel(item.fulfilmentStatus)}</Badge>
                  {item.trackingNumber && (
                    <span className="font-mono text-[0.72rem] text-muted">
                      {item.trackingCarrier} {item.trackingNumber}
                    </span>
                  )}
                </div>
              </div>

              <p className="shrink-0 font-mono text-[0.9rem] text-ink">
                {formatMoney(item.lineTotalMinor, order.currency)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Totals and delivery ── */}
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="totals-heading">
          <h2 id="totals-heading" className="eyebrow mb-3">
            Payment
          </h2>
          <dl className="space-y-2.5 text-[0.86rem]">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-ink">{formatMoney(order.subtotalMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Shipping ({order.shippingMethod})</dt>
              <dd className="text-ink">
                {order.shippingTotalMinor > 0 ? formatMoney(order.shippingTotalMinor, order.currency) : 'Free'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2.5">
              <dt className="text-base text-ink">Total paid</dt>
              <dd className="font-mono text-xl text-accent-300">{formatMoney(order.totalMinor, order.currency)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="eyebrow mb-3">
            Delivering to
          </h2>
          <address className="space-y-0.5 text-[0.86rem] not-italic leading-relaxed text-muted">
            <p className="text-ink">{order.shippingAddress.fullName}</p>
            <p>{order.shippingAddress.line1}</p>
            {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
            </p>
            <p>{order.shippingAddress.country}</p>
            <p className="pt-1.5">{order.shippingAddress.phone}</p>
          </address>
        </section>
      </div>

      {/* ── What happens next ── */}
      {isPaid && (
        <section className="mt-10 rounded-2xl border border-line bg-surface-0/50 p-6" aria-labelledby="next-heading">
          <h2 id="next-heading" className="eyebrow mb-4">
            What happens next
          </h2>
          <ol className="space-y-4 text-[0.86rem] leading-relaxed text-muted">
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-300 font-mono text-[0.7rem] text-white">
                1
              </span>
              The studio has been notified and will prepare your piece.
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[0.7rem]">
                2
              </span>
              <span className="inline-flex items-start gap-2">
                <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                When it ships, the tracking details appear on this order in your account.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[0.7rem]">
                3
              </span>
              Once it is delivered you can leave a review on the piece.
            </li>
          </ol>
        </section>
      )}

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Button variant="primary" to={`/account/orders/${order.orderNumber}`}>
          Track this order
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="secondary" to="/shop">
          Keep exploring
        </Button>
        <Button variant="ghost" to="/gallery">
          Back to the gallery
        </Button>
      </div>
    </div>
  );
};

export default OrderConfirmationPage;
