import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertCircle, Check, CreditCard, Lock, MapPin, ShoppingBag, Truck } from 'lucide-react';
import api, { errorCode, errorDetails, errorMessage } from '../lib/api';
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  NoticeBanner,
  Select,
  Textarea,
} from '../components/ui';
import { formatMoney } from '../lib/format';
import { imageSource } from '../lib/images';
import { useDocumentTitle, useSessionValue } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useCart } from '../store/cart';
import { useUi } from '../store/ui';
import { isInlineProvider, mountStripeElement, runGatewayCheckout } from '../lib/paymentGateways';

const EMPTY_ADDRESS = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
};

const STEPS = [
  { key: 'address', label: 'Delivery', icon: MapPin },
  { key: 'shipping', label: 'Shipping', icon: Truck },
  { key: 'payment', label: 'Payment', icon: CreditCard },
];

export const CheckoutPage = () => {
  useDocumentTitle('Checkout');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuth((state) => state.user);
  const toast = useUi((state) => state.toast);
  const loadCart = useCart((state) => state.load);
  const addToCart = useCart((state) => state.add);

  const [step, setStep] = useState('address');
  const [shippingMethod, setShippingMethod] = useState('standard');
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billingAddress, setBillingAddress] = useState(EMPTY_ADDRESS);
  const [customerNote, setCustomerNote] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);

  const [fieldErrors, setFieldErrors] = useState({});
  const [paymentError, setPaymentError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | creating | gateway | verifying

  // Stripe renders inline, so its element and the created order must survive
  // between mounting the fields and confirming them.
  const [pendingOrder, setPendingOrder] = useState(null);
  const stripeHandleRef = useRef(null);
  const stripeContainerRef = useRef(null);

  /**
   * One idempotency key per browser tab per checkout attempt. If the customer
   * double-clicks, or the network retries, the server returns the same order
   * instead of creating a second one.
   */
  const [idempotencyKey, clearIdempotencyKey] = useSessionValue('abj-checkout-key', () =>
    `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  );

  /* ── Buy Now ──
     /checkout?buyNow=<id> adds the piece then drops the parameter, so a
     refresh does not add it a second time. */
  const buyNowId = searchParams.get('buyNow');

  useEffect(() => {
    if (!buyNowId) return;

    addToCart({ id: buyNowId }).then(() => {
      navigate('/checkout', { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyNowId]);

  /* ── Server-authoritative review ── */

  const review = useQuery({
    queryKey: ['checkout-review', shippingMethod],
    queryFn: async () => {
      const { data } = await api.get('/checkout/review', { params: { shippingMethod } });
      return data;
    },
    enabled: !buyNowId,
    retry: false,
  });

  const config = useQuery({
    queryKey: ['checkout-config'],
    queryFn: async () => {
      const { data } = await api.get('/checkout/config');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: async () => {
      const { data } = await api.get('/account/addresses');
      return data;
    },
  });

  // Pre-fill from the saved default, so a returning customer types nothing.
  useEffect(() => {
    const saved = addresses.data?.items ?? [];
    if (!saved.length || selectedAddressId) return;

    const preferred = saved.find((entry) => entry.isDefault) ?? saved[0];
    setSelectedAddressId(preferred.id);
    setAddress({
      fullName: preferred.fullName,
      phone: preferred.phone,
      line1: preferred.line1,
      line2: preferred.line2 ?? '',
      city: preferred.city,
      state: preferred.state,
      postalCode: preferred.postalCode,
      country: preferred.country,
    });
    setSaveAddress(false);
  }, [addresses.data, selectedAddressId]);

  const payment = config.data?.payment ?? review.data?.payment;
  const paymentsEnabled = payment?.enabled === true;
  const isSimulated = payment?.isSimulated === true;

  const totals = review.data?.totals;
  const items = review.data?.items ?? [];
  const issues = review.data?.issues ?? [];
  const canProceed = review.data?.canProceed === true;

  /* ── Validation ── */

  const validateAddress = useCallback((candidate) => {
    const errors = {};
    if (!candidate.fullName?.trim() || candidate.fullName.trim().length < 2) errors.fullName = 'Enter the recipient name.';
    if (!candidate.phone?.trim() || candidate.phone.trim().length < 6) errors.phone = 'Enter a contact number.';
    if (!candidate.line1?.trim() || candidate.line1.trim().length < 4) errors.line1 = 'Enter the street address.';
    if (!candidate.city?.trim()) errors.city = 'Enter the city.';
    if (!candidate.state?.trim()) errors.state = 'Enter the state or region.';
    if (!candidate.postalCode?.trim() || candidate.postalCode.trim().length < 3) errors.postalCode = 'Enter the postal code.';
    if (!candidate.country?.trim()) errors.country = 'Enter the country.';
    return errors;
  }, []);

  const goToShipping = () => {
    const errors = validateAddress(address);
    if (!billingSameAsShipping) {
      Object.entries(validateAddress(billingAddress)).forEach(([key, message]) => {
        errors[`billing.${key}`] = message;
      });
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      toast({ title: 'Check the delivery details', message: 'Some fields still need attention.', tone: 'negative' });
      return;
    }
    setStep('shipping');
  };

  /* ── Pay ── */

  const startPayment = async () => {
    setPaymentError(null);

    if (!paymentsEnabled) {
      setPaymentError('Online payment is not configured on this server, so this order cannot be completed.');
      return;
    }

    setPhase('creating');

    // Save the address for next time, if asked. A failure here must not stop
    // the purchase.
    if (saveAddress && !selectedAddressId) {
      api.post('/account/addresses', { ...address, label: 'Delivery' }).catch(() => {});
    }

    let created;
    try {
      const { data } = await api.post('/checkout', {
        shippingAddress: address,
        billingAddress: billingSameAsShipping ? null : billingAddress,
        shippingMethod,
        customerNote,
        idempotencyKey,
      });
      created = data;
    } catch (error) {
      setPhase('idle');

      if (errorCode(error) === 'CART_CHANGED') {
        await review.refetch();
        await loadCart({ silent: true });
        setPaymentError(
          'Your cart changed while you were checking out. Nothing has been charged — please review the items above and try again.',
        );
        return;
      }

      setFieldErrors(errorDetails(error) ?? {});
      setPaymentError(errorMessage(error, 'We could not start that payment. Nothing has been charged.'));
      return;
    }

    // Stripe renders its fields inline: hold the order and mount the element.
    if (isInlineProvider(created.payment.provider)) {
      setPendingOrder(created);
      setPhase('gateway');
      return;
    }

    await handOffToGateway(created);
  };

  const handOffToGateway = async (created) => {
    setPhase('gateway');

    let result;
    try {
      result = await runGatewayCheckout({
        config: payment,
        payment: created.payment,
        order: created.order,
        customer: user,
      });
    } catch (error) {
      setPhase('idle');
      setPaymentError(error.message ?? 'The payment gateway could not be opened.');
      return;
    }

    await finishPayment(created, result);
  };

  /** Mount the Stripe Payment Element once we have an order to pay for. */
  useEffect(() => {
    if (!pendingOrder || !isInlineProvider(pendingOrder.payment.provider)) return undefined;
    if (!stripeContainerRef.current) return undefined;

    let cancelled = false;

    mountStripeElement({
      config: payment,
      payment: pendingOrder.payment,
      container: stripeContainerRef.current,
    })
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        stripeHandleRef.current = handle;
      })
      .catch((error) => {
        setPhase('idle');
        setPaymentError(error.message ?? 'The Stripe payment fields could not be loaded.');
      });

    return () => {
      cancelled = true;
      stripeHandleRef.current?.destroy?.();
      stripeHandleRef.current = null;
    };
  }, [pendingOrder, payment]);

  const confirmStripe = async () => {
    if (!stripeHandleRef.current || !pendingOrder) return;

    setPaymentError(null);
    setPhase('verifying');

    const result = await stripeHandleRef.current.confirm();
    await finishPayment(pendingOrder, result);
  };

  /**
   * Hands the gateway's identifiers to the server for verification. The
   * gateway saying "succeeded" is not enough — only the server's answer
   * decides whether the order is confirmed.
   */
  const finishPayment = async (created, result) => {
    if (result.status === 'dismissed') {
      setPhase('idle');
      setPaymentError('You closed the payment window before paying. Nothing has been charged.');
      // Release the pending order so the stock is not held unnecessarily.
      api.post('/payments/cancel', { orderId: created.order.id }).catch(() => {});
      clearIdempotencyKey();
      return;
    }

    if (result.status === 'invalid') {
      setPhase('gateway');
      setPaymentError(result.message);
      return;
    }

    if (result.status === 'failed') {
      setPhase('idle');
      setPaymentError(`${result.message} Nothing has been charged. You can try again.`);
      return;
    }

    setPhase('verifying');

    try {
      const { data } = await api.post('/payments/confirm', {
        orderId: created.order.id,
        providerOrderId: result.providerOrderId,
        providerPaymentId: result.providerPaymentId,
        signature: result.signature,
      });

      clearIdempotencyKey();
      await loadCart({ silent: true });

      navigate(`/order-confirmation/${data.order.orderNumber}`, {
        replace: true,
        state: { order: data.order, payment: data.payment },
      });
    } catch (error) {
      setPhase('idle');
      setPaymentError(
        errorMessage(
          error,
          'We could not verify that payment. If you were charged, nothing is lost — contact us with your order number and we will sort it out.',
        ),
      );
    }
  };

  /* ── States ── */

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          icon={Lock}
          title="Sign in to check out"
          message="Your cart, addresses and orders live in your account."
          action={
            <Button variant="primary" to="/login" state={{ from: '/checkout' }}>
              Sign in
            </Button>
          }
        />
      </div>
    );
  }

  if (buyNowId || review.isLoading) return <LoadingBlock label="Preparing your order" className="min-h-[60vh]" />;

  if (review.isError) {
    const empty = /empty/i.test(errorMessage(review.error));

    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          icon={ShoppingBag}
          title={empty ? 'Your cart is empty' : 'Checkout could not be opened'}
          message={empty ? 'Add something to your cart before checking out.' : errorMessage(review.error)}
          action={
            <Button variant="primary" to="/shop">
              Explore artwork
            </Button>
          }
        />
      </div>
    );
  }

  const busy = phase !== 'idle';
  const stepIndex = STEPS.findIndex((entry) => entry.key === step);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="mb-9 space-y-2">
        <p className="eyebrow">Secure checkout</p>
        <h1 className="text-display-lg">Complete your order</h1>
      </header>

      {/* ── Step indicator ── */}
      <ol className="mb-10 flex items-center gap-2 sm:gap-4">
        {STEPS.map((entry, index) => {
          const Icon = entry.icon;
          const done = index < stepIndex;
          const current = index === stepIndex;

          return (
            <li key={entry.key} className="flex flex-1 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => index <= stepIndex && setStep(entry.key)}
                disabled={index > stepIndex || busy}
                className={clsx(
                  'flex items-center gap-2.5 rounded-full px-1 transition-colors',
                  index <= stepIndex && !busy && 'cursor-pointer',
                )}
              >
                <span
                  className={clsx(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[0.78rem] transition-colors',
                    done && 'border-accent-300 bg-accent-300 text-ink',
                    current && 'border-accent-300 text-accent-300',
                    !done && !current && 'border-charcoal-600 text-muted',
                  )}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span
                  className={clsx(
                    'hidden text-[0.84rem] sm:block',
                    current ? 'text-parchment' : 'text-muted',
                  )}
                >
                  {entry.label}
                </span>
              </button>
              {index < STEPS.length - 1 && (
                <span className={clsx('h-px flex-1', done ? 'bg-accent-300/50' : 'bg-charcoal-700')} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      {/* ── Blocking issues from the server's re-price ── */}
      {issues.length > 0 && (
        <div className="mb-8 space-y-2.5">
          {issues.map((issue, index) => (
            <NoticeBanner key={index} tone="warning" title="Your cart changed">
              {issue.message}
            </NoticeBanner>
          ))}
          {!canProceed && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" to="/cart">
                Review my cart
              </Button>
              <Button variant="ghost" size="sm" onClick={() => review.refetch()}>
                Check again
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
        {/* ──────────────── Form column ──────────────── */}
        <div className="space-y-8">
          {/* ── Step 1: Delivery ── */}
          {step === 'address' && (
            <section className="space-y-6" aria-labelledby="delivery-heading">
              <h2 id="delivery-heading" className="font-display text-2xl">
                Where should it go?
              </h2>

              {Boolean(addresses.data?.items?.length) && (
                <div className="space-y-2.5">
                  <p className="eyebrow">Saved addresses</p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {addresses.data.items.map((saved) => (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => {
                          setSelectedAddressId(saved.id);
                          setAddress({
                            fullName: saved.fullName,
                            phone: saved.phone,
                            line1: saved.line1,
                            line2: saved.line2 ?? '',
                            city: saved.city,
                            state: saved.state,
                            postalCode: saved.postalCode,
                            country: saved.country,
                          });
                          setFieldErrors({});
                        }}
                        className={clsx(
                          'rounded-2xl border p-4 text-left text-[0.82rem] transition-colors',
                          selectedAddressId === saved.id
                            ? 'border-accent-300 bg-accent-300/[0.06]'
                            : 'border-charcoal-600 hover:border-charcoal-500',
                        )}
                      >
                        <p className="font-medium text-parchment">{saved.label}</p>
                        <p className="mt-1 text-muted">
                          {saved.fullName} · {saved.line1}, {saved.city}, {saved.state} {saved.postalCode}
                        </p>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAddressId(null);
                        setAddress(EMPTY_ADDRESS);
                        setSaveAddress(true);
                      }}
                      className={clsx(
                        'rounded-2xl border border-dashed p-4 text-left text-[0.82rem] transition-colors',
                        selectedAddressId === null
                          ? 'border-accent-300 text-accent-300'
                          : 'border-charcoal-600 text-muted hover:border-charcoal-500',
                      )}
                    >
                      Use a new address
                    </button>
                  </div>
                </div>
              )}

              <AddressFields
                values={address}
                onChange={(changes) => setAddress((current) => ({ ...current, ...changes }))}
                errors={fieldErrors}
                prefix=""
              />

              {!selectedAddressId && (
                <Checkbox
                  checked={saveAddress}
                  onChange={(event) => setSaveAddress(event.target.checked)}
                  label="Save this address to my account"
                />
              )}

              <Checkbox
                checked={billingSameAsShipping}
                onChange={(event) => setBillingSameAsShipping(event.target.checked)}
                label="My billing address is the same"
              />

              {!billingSameAsShipping && (
                <div className="space-y-5 rounded-2xl border border-charcoal-700 p-5">
                  <h3 className="eyebrow">Billing address</h3>
                  <AddressFields
                    values={billingAddress}
                    onChange={(changes) => setBillingAddress((current) => ({ ...current, ...changes }))}
                    errors={fieldErrors}
                    prefix="billing."
                  />
                </div>
              )}

              <Field label="Note for the studio" htmlFor="checkout-note" hint="Optional.">
                <Textarea
                  id="checkout-note"
                  value={customerNote}
                  onChange={(event) => setCustomerNote(event.target.value)}
                  placeholder="Gift wrapping, delivery instructions, anything the artist should know…"
                  rows={3}
                  maxLength={1000}
                />
              </Field>

              <Button variant="primary" size="lg" onClick={goToShipping}>
                Continue to shipping
              </Button>
            </section>
          )}

          {/* ── Step 2: Shipping ── */}
          {step === 'shipping' && (
            <section className="space-y-6" aria-labelledby="shipping-heading">
              <h2 id="shipping-heading" className="font-display text-2xl">
                How should it travel?
              </h2>

              <div className="space-y-2.5" role="radiogroup" aria-label="Shipping method">
                {(config.data?.shippingMethods ?? []).map((method) => (
                  <button
                    key={method.key}
                    type="button"
                    role="radio"
                    aria-checked={shippingMethod === method.key}
                    onClick={() => setShippingMethod(method.key)}
                    className={clsx(
                      'flex w-full items-start justify-between gap-4 rounded-2xl border p-5 text-left transition-colors',
                      shippingMethod === method.key
                        ? 'border-accent-300 bg-accent-300/[0.06]'
                        : 'border-charcoal-600 hover:border-charcoal-500',
                    )}
                  >
                    <div className="space-y-1">
                      <p className="text-[0.92rem] text-parchment">{method.label}</p>
                      <p className="text-[0.8rem] leading-relaxed text-muted">{method.description}</p>
                    </div>
                    <p className="shrink-0 font-mono text-[0.85rem] text-accent-300">
                      {method.upliftMinor > 0 ? `+${formatMoney(method.upliftMinor, totals?.currency)}` : 'Included'}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('address')}>
                  Back
                </Button>
                <Button variant="primary" size="lg" onClick={() => setStep('payment')}>
                  Continue to payment
                </Button>
              </div>
            </section>
          )}

          {/* ── Step 3: Payment ── */}
          {step === 'payment' && (
            <section className="space-y-6" aria-labelledby="payment-heading">
              <h2 id="payment-heading" className="font-display text-2xl">
                Payment
              </h2>

              {/* The honest statement of what this server can actually do. */}
              {!paymentsEnabled ? (
                <NoticeBanner tone="warning" title="Online payment is not configured">
                  {payment?.reason ??
                    'This server has no payment gateway set up, so an order cannot be completed here.'}{' '}
                  Everything up to this point is real and your cart is saved — once a gateway is
                  configured, checkout will work without any further change.
                </NoticeBanner>
              ) : isSimulated ? (
                <NoticeBanner tone="warning" title="Simulated payment gateway">
                  {payment.notice ??
                    'This server is running the development payment simulator. No card is taken and no money moves.'}{' '}
                  Your order will be created and marked clearly as a simulated payment.
                </NoticeBanner>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-accent-300/25 bg-accent-300/[0.05] px-4 py-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
                  <p className="text-[0.82rem] leading-relaxed text-parchment/90">
                    Payment is taken by <span className="text-accent-300">{payment.provider}</span> in their own
                    secure window. Your card details never reach our server, and your order is confirmed only
                    after we verify the payment with the gateway.
                  </p>
                </div>
              )}

              {paymentError && (
                <div
                  className="flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/8 px-4 py-3"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                  <p className="text-[0.84rem] leading-relaxed text-red-100">{paymentError}</p>
                </div>
              )}

              {/* Stripe's inline fields */}
              {pendingOrder && isInlineProvider(pendingOrder.payment.provider) && (
                <div className="space-y-4">
                  <div ref={stripeContainerRef} className="rounded-2xl border border-charcoal-600 p-4" />
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={confirmStripe}
                    loading={phase === 'verifying'}
                    className="w-full"
                  >
                    Pay {formatMoney(totals?.totalMinor, totals?.currency)}
                  </Button>
                </div>
              )}

              {!pendingOrder && (
                <div className="space-y-3">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={startPayment}
                    loading={busy}
                    disabled={!paymentsEnabled || !canProceed}
                    className="w-full"
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    {phase === 'creating'
                      ? 'Creating your order…'
                      : phase === 'gateway'
                        ? 'Waiting for the gateway…'
                        : phase === 'verifying'
                          ? 'Verifying your payment…'
                          : paymentsEnabled
                            ? `Pay ${formatMoney(totals?.totalMinor, totals?.currency)}`
                            : 'Payment unavailable'}
                  </Button>

                  <Button variant="secondary" onClick={() => setStep('shipping')} disabled={busy} className="w-full">
                    Back to shipping
                  </Button>
                </div>
              )}

              <p className="text-[0.74rem] leading-relaxed text-muted">
                By paying you agree that artwork remains the property of its artist until dispatch, and that
                originals are one-of-a-kind and non-returnable once delivered unless damaged in transit.
              </p>
            </section>
          )}
        </div>

        {/* ──────────────── Summary column ──────────────── */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="panel space-y-5 p-6">
            <h2 className="font-display text-xl">Your order</h2>

            <ul className="space-y-3.5 border-b border-charcoal-700 pb-5">
              {items.map(({ artwork, quantity, lineTotalMinor }) => (
                <li key={artwork.id} className="flex gap-3">
                  <div className="h-16 w-13 shrink-0 overflow-hidden rounded-sm bg-charcoal-800">
                    {artwork.image && (
                      <img
                        src={imageSource(artwork.image, { preferThumb: true })}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.84rem] text-parchment">{artwork.title}</p>
                    <p className="truncate text-[0.74rem] text-muted">{artwork.artist?.displayName}</p>
                    <p className="font-mono text-[0.74rem] text-muted">Qty {quantity}</p>
                  </div>
                  <p className="shrink-0 font-mono text-[0.8rem] text-parchment">
                    {formatMoney(lineTotalMinor, totals?.currency)}
                  </p>
                </li>
              ))}
            </ul>

            <dl className="space-y-2.5 text-[0.86rem]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-parchment">{formatMoney(totals?.subtotalMinor, totals?.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Shipping</dt>
                <dd className="text-parchment">
                  {totals?.shippingTotalMinor > 0 ? formatMoney(totals.shippingTotalMinor, totals.currency) : 'Free'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-charcoal-700 pt-3">
                <dt className="text-base text-parchment">Total</dt>
                <dd className="font-mono text-2xl text-accent-300">
                  {formatMoney(totals?.totalMinor, totals?.currency)}
                </dd>
              </div>
            </dl>

            <p className="text-[0.72rem] leading-relaxed text-muted">
              Every amount here is calculated on our server from the current listings, not from your browser.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

const AddressFields = ({ values, onChange, errors, prefix }) => {
  const error = (key) => errors[`${prefix}${key}`];

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Recipient name" htmlFor={`${prefix}fullName`} error={error('fullName')} required className="sm:col-span-2">
        <Input
          id={`${prefix}fullName`}
          value={values.fullName}
          onChange={(event) => onChange({ fullName: event.target.value })}
          error={error('fullName')}
          autoComplete="name"
          required
        />
      </Field>

      <Field label="Phone" htmlFor={`${prefix}phone`} error={error('phone')} required>
        <Input
          id={`${prefix}phone`}
          type="tel"
          value={values.phone}
          onChange={(event) => onChange({ phone: event.target.value })}
          error={error('phone')}
          autoComplete="tel"
          placeholder="+91 90000 00000"
          required
        />
      </Field>

      <Field label="Postal code" htmlFor={`${prefix}postalCode`} error={error('postalCode')} required>
        <Input
          id={`${prefix}postalCode`}
          value={values.postalCode}
          onChange={(event) => onChange({ postalCode: event.target.value })}
          error={error('postalCode')}
          autoComplete="postal-code"
          required
        />
      </Field>

      <Field label="Address" htmlFor={`${prefix}line1`} error={error('line1')} required className="sm:col-span-2">
        <Input
          id={`${prefix}line1`}
          value={values.line1}
          onChange={(event) => onChange({ line1: event.target.value })}
          error={error('line1')}
          autoComplete="address-line1"
          placeholder="Flat, building, street"
          required
        />
      </Field>

      <Field label="Address line 2" htmlFor={`${prefix}line2`} hint="Optional." className="sm:col-span-2">
        <Input
          id={`${prefix}line2`}
          value={values.line2}
          onChange={(event) => onChange({ line2: event.target.value })}
          autoComplete="address-line2"
          placeholder="Area, landmark"
        />
      </Field>

      <Field label="City" htmlFor={`${prefix}city`} error={error('city')} required>
        <Input
          id={`${prefix}city`}
          value={values.city}
          onChange={(event) => onChange({ city: event.target.value })}
          error={error('city')}
          autoComplete="address-level2"
          required
        />
      </Field>

      <Field label="State or region" htmlFor={`${prefix}state`} error={error('state')} required>
        <Input
          id={`${prefix}state`}
          value={values.state}
          onChange={(event) => onChange({ state: event.target.value })}
          error={error('state')}
          autoComplete="address-level1"
          required
        />
      </Field>

      <Field label="Country" htmlFor={`${prefix}country`} error={error('country')} required className="sm:col-span-2">
        <Select
          id={`${prefix}country`}
          value={values.country}
          onChange={(event) => onChange({ country: event.target.value })}
          error={error('country')}
        >
          {['India', 'United Kingdom', 'United States', 'United Arab Emirates', 'Singapore', 'Australia', 'Canada'].map(
            (country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ),
          )}
        </Select>
      </Field>
    </div>
  );
};

export default CheckoutPage;
