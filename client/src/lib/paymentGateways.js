/**
 * Browser-side payment gateway handoff.
 *
 * Each adapter opens the gateway's own UI, then returns the identifiers the
 * server needs to VERIFY the payment. None of them decides that a payment
 * succeeded — that is always the server's call, made against the gateway.
 *
 * Both real gateways are loaded from their official CDN script rather than an
 * npm package, so card fields are rendered inside the gateway's own iframe and
 * raw card details never touch this application's code at all.
 */

const scriptCache = new Map();

const loadScript = (src) => {
  if (scriptCache.has(src)) return scriptCache.get(src);

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      scriptCache.delete(src);
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });

  scriptCache.set(src, promise);
  return promise;
};

/* ─────────────────────────── Razorpay ─────────────────────────── */

const openRazorpay = async ({ config, payment, order, customer }) => {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');

  if (!window.Razorpay) throw new Error('The Razorpay checkout could not be opened.');

  return new Promise((resolve) => {
    const checkout = new window.Razorpay({
      key: config.keyId,
      amount: payment.amount ?? payment.amountMinor,
      currency: payment.currency,
      name: 'Arts by Jay',
      description: `Order ${order.orderNumber}`,
      order_id: payment.orderId,
      prefill: { name: customer?.name ?? '', email: customer?.email ?? '' },
      theme: { color: '#c5ff3d', backdrop_color: '#0f110f' },

      // Razorpay hands back an HMAC over order_id|payment_id. The server
      // recomputes it with the key secret, so a forged value cannot pass.
      handler: (response) =>
        resolve({
          status: 'completed',
          providerOrderId: response.razorpay_order_id,
          providerPaymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),

      modal: {
        ondismiss: () => resolve({ status: 'dismissed' }),
      },
    });

    checkout.on('payment.failed', (response) =>
      resolve({
        status: 'failed',
        message: response?.error?.description ?? 'The payment was declined.',
      }),
    );

    checkout.open();
  });
};

/* ──────────────────────────── Stripe ──────────────────────────── */

let stripeInstance = null;

const getStripe = async (publishableKey) => {
  await loadScript('https://js.stripe.com/v3/');
  if (!window.Stripe) throw new Error('Stripe.js could not be loaded.');

  stripeInstance = stripeInstance ?? window.Stripe(publishableKey);
  return stripeInstance;
};

/**
 * Mounts the Stripe Payment Element into `container`. Returns a handle whose
 * `confirm()` completes the payment. Two steps, because Stripe renders its
 * fields inline rather than in a modal.
 */
export const mountStripeElement = async ({ config, payment, container }) => {
  const stripe = await getStripe(config.publishableKey);

  const elements = stripe.elements({
    clientSecret: payment.clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#c5ff3d',
        colorBackground: '#141714',
        colorText: '#f4f6f2',
        colorDanger: '#f87171',
        fontFamily: 'Inter, system-ui, sans-serif',
        borderRadius: '12px',
      },
    },
  });

  const paymentElement = elements.create('payment', { layout: 'tabs' });
  paymentElement.mount(container);

  return {
    element: paymentElement,
    destroy: () => paymentElement.destroy(),

    confirm: async () => {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        // Stay on the page unless the payment method demands a redirect.
        redirect: 'if_required',
        confirmParams: {},
      });

      if (error) {
        return {
          status: error.type === 'validation_error' ? 'invalid' : 'failed',
          message: error.message ?? 'The payment could not be completed.',
        };
      }

      if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
        // The intent id is all the server needs; it re-reads the real status
        // from Stripe before settling anything.
        return {
          status: 'completed',
          providerOrderId: paymentIntent.id,
          providerPaymentId: paymentIntent.id,
          signature: '',
        };
      }

      return { status: 'failed', message: `Stripe reported status "${paymentIntent?.status}".` };
    },
  };
};

/* ─────────────────────── Simulated gateway ─────────────────────── */

/**
 * The development simulator. It takes no card details and moves no money;
 * it simply returns the HMAC the server's `dev` adapter minted, so the same
 * server-side verification path is exercised as with a real gateway.
 */
const runSimulatedGateway = async ({ payment }) =>
  new Promise((resolve) => {
    // A frame's delay so the confirming state is visible, as it would be with
    // a real gateway round trip.
    setTimeout(
      () =>
        resolve({
          status: 'completed',
          providerOrderId: payment.orderId,
          providerPaymentId: payment.paymentId,
          signature: payment.signature,
          simulated: true,
        }),
      650,
    );
  });

/* ──────────────────────────── Dispatch ──────────────────────────── */

/** True when the provider renders its fields inline rather than in a modal. */
export const isInlineProvider = (provider) => provider === 'stripe';

export const runGatewayCheckout = async ({ config, payment, order, customer }) => {
  switch (config.provider) {
    case 'razorpay':
      return openRazorpay({ config, payment, order, customer });
    case 'dev':
      return runSimulatedGateway({ payment });
    case 'stripe':
      // Stripe is handled by mountStripeElement, not here.
      throw new Error('Stripe is confirmed through its mounted element.');
    default:
      throw new Error(`No browser flow is implemented for "${config.provider}".`);
  }
};
