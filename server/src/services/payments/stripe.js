import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';

let client = null;

const getClient = async () => {
  if (client) return client;

  if (!env.payments.stripe.secretKey) {
    throw ApiError.notConfigured('Stripe keys are not configured on this server.');
  }

  const { default: Stripe } = await import('stripe');
  client = new Stripe(env.payments.stripe.secretKey);
  return client;
};

export const id = 'stripe';

export const isConfigured = () =>
  Boolean(env.payments.stripe.secretKey && env.payments.stripe.publishableKey);

export const publicConfig = () => ({
  provider: 'stripe',
  publishableKey: env.payments.stripe.publishableKey,
  currency: env.payments.currency,
  isSimulated: false,
});

export const createIntent = async ({ order, amountMinor, currency }) => {
  const stripe = await getClient();

  const intent = await stripe.paymentIntents.create(
    {
      amount: amountMinor,
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { orderNumber: order.orderNumber, orderId: order._id.toString() },
    },
    // Stripe de-duplicates retries of the same checkout attempt for us.
    { idempotencyKey: `intent_${order._id.toString()}` },
  );

  return {
    providerOrderId: intent.id,
    clientPayload: { clientSecret: intent.client_secret, amount: amountMinor, currency },
    providerMeta: { status: intent.status },
  };
};

/**
 * Stripe gives the browser no HMAC to echo back, so there is nothing to
 * verify locally. We always confirm by asking Stripe directly.
 */
export const verifyClientSignature = () => false;

export const fetchPayment = async (providerPaymentId) => {
  const stripe = await getClient();
  const intent = await stripe.paymentIntents.retrieve(providerPaymentId);

  return {
    status: intent.status === 'succeeded' ? 'captured' : intent.status,
    amountMinor: intent.amount_received || intent.amount,
    currency: intent.currency.toUpperCase(),
    providerOrderId: intent.id,
    raw: { status: intent.status },
  };
};

export const verifyWebhook = async ({ rawBody, headers }) => {
  const secret = env.payments.stripe.webhookSecret;
  if (!secret) throw ApiError.notConfigured('STRIPE_WEBHOOK_SECRET is not configured.');

  const stripe = await getClient();
  const signature = headers['stripe-signature'];
  if (!signature) return { ok: false };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { ok: false };
  }

  const object = event.data?.object ?? {};

  const typeMap = {
    'payment_intent.succeeded': 'payment_succeeded',
    'payment_intent.payment_failed': 'payment_failed',
    'charge.refunded': 'refund_succeeded',
  };

  return {
    ok: true,
    eventId: event.id,
    type: typeMap[event.type] ?? 'ignored',
    providerOrderId: object.payment_intent ?? object.id ?? '',
    providerPaymentId: object.payment_intent ?? object.id ?? '',
    amountMinor: object.amount_received ?? object.amount ?? 0,
    currency: (object.currency ?? env.payments.currency).toUpperCase(),
    failureReason: object.last_payment_error?.message ?? '',
    raw: { event: event.type },
  };
};

export const refund = async ({ providerPaymentId, amountMinor, reason }) => {
  const stripe = await getClient();
  const created = await stripe.refunds.create({
    payment_intent: providerPaymentId,
    amount: amountMinor,
    metadata: { reason: reason ?? '' },
  });
  return { providerRefundId: created.id, amountMinor: created.amount };
};
