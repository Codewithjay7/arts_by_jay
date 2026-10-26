import crypto from 'node:crypto';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';

let client = null;

const getClient = async () => {
  if (client) return client;

  const { keyId, keySecret } = env.payments.razorpay;
  if (!keyId || !keySecret) {
    throw ApiError.notConfigured('Razorpay keys are not configured on this server.');
  }

  const { default: Razorpay } = await import('razorpay');
  client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return client;
};

export const id = 'razorpay';

export const isConfigured = () =>
  Boolean(env.payments.razorpay.keyId && env.payments.razorpay.keySecret);

/** Values the browser needs to open the Razorpay checkout. No secrets here. */
export const publicConfig = () => ({
  provider: 'razorpay',
  keyId: env.payments.razorpay.keyId,
  currency: env.payments.currency,
  isSimulated: false,
});

export const createIntent = async ({ order, amountMinor, currency }) => {
  const rzp = await getClient();

  const created = await rzp.orders.create({
    amount: amountMinor,
    currency,
    receipt: order.orderNumber,
    notes: { orderNumber: order.orderNumber, orderId: order._id.toString() },
  });

  return {
    providerOrderId: created.id,
    clientPayload: { orderId: created.id, amount: created.amount, currency: created.currency },
    providerMeta: { status: created.status, receipt: created.receipt },
  };
};

/**
 * Verifies the HMAC the browser receives from Razorpay. This proves the
 * payment id was produced by Razorpay for this order, which is why the
 * client own success claim is never enough by itself.
 */
export const verifyClientSignature = ({ providerOrderId, providerPaymentId, signature }) => {
  if (!providerOrderId || !providerPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', env.payments.razorpay.keySecret)
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/** Confirms with Razorpay directly that the charge really is captured. */
export const fetchPayment = async (providerPaymentId) => {
  const rzp = await getClient();
  const payment = await rzp.payments.fetch(providerPaymentId);
  return {
    status: payment.status === 'captured' || payment.status === 'authorized' ? 'captured' : payment.status,
    amountMinor: payment.amount,
    currency: payment.currency,
    providerOrderId: payment.order_id,
    raw: { method: payment.method, status: payment.status, email: payment.email },
  };
};

export const verifyWebhook = ({ rawBody, headers }) => {
  const secret = env.payments.razorpay.webhookSecret;
  if (!secret) throw ApiError.notConfigured('RAZORPAY_WEBHOOK_SECRET is not configured.');

  const signature = headers['x-razorpay-signature'];
  if (!signature) return { ok: false };

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  const event = JSON.parse(rawBody.toString('utf8'));
  const entity = event.payload?.payment?.entity ?? {};

  const typeMap = {
    'payment.captured': 'payment_succeeded',
    'payment.authorized': 'payment_succeeded',
    'payment.failed': 'payment_failed',
    'refund.processed': 'refund_succeeded',
  };

  return {
    ok: true,
    eventId: event.id ?? `${event.event}:${entity.id ?? ''}`,
    type: typeMap[event.event] ?? 'ignored',
    providerOrderId: entity.order_id ?? '',
    providerPaymentId: entity.id ?? '',
    amountMinor: entity.amount ?? 0,
    currency: entity.currency ?? env.payments.currency,
    failureReason: entity.error_description ?? '',
    raw: { event: event.event, method: entity.method },
  };
};

export const refund = async ({ providerPaymentId, amountMinor, reason }) => {
  const rzp = await getClient();
  const created = await rzp.payments.refund(providerPaymentId, {
    amount: amountMinor,
    notes: { reason: reason ?? '' },
  });
  return { providerRefundId: created.id, amountMinor: created.amount };
};
