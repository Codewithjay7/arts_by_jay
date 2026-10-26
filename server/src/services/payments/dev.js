import crypto from 'node:crypto';
import env from '../../config/env.js';

/**
 * A SIMULATED gateway for local development and automated flow tests.
 *
 * It takes no card details and moves no money. Every order it settles is
 * flagged `isSimulatedPayment: true` and every API response it produces says
 * `isSimulated: true`, so a simulated sale can never be mistaken for a real
 * one in the UI, in reports, or in artist earnings.
 *
 * env.js refuses to boot with PAYMENT_PROVIDER=dev when NODE_ENV=production.
 */

const SIM_SECRET = 'arts-by-jay-simulated-gateway';

export const id = 'dev';

export const isConfigured = () => true;

export const publicConfig = () => ({
  provider: 'dev',
  currency: env.payments.currency,
  isSimulated: true,
  notice:
    'Simulated payment gateway. No card is taken and no money moves. Configure Razorpay or Stripe for real payments.',
});

const sign = (providerOrderId, providerPaymentId) =>
  crypto.createHmac('sha256', SIM_SECRET).update(`${providerOrderId}|${providerPaymentId}`).digest('hex');

export const createIntent = async ({ order, amountMinor, currency }) => {
  const providerOrderId = `sim_order_${order._id.toString()}`;
  const providerPaymentId = `sim_pay_${crypto.randomBytes(8).toString('hex')}`;

  return {
    providerOrderId,
    clientPayload: {
      // The simulated checkout screen echoes these straight back, mirroring
      // the shape a real gateway handoff produces.
      orderId: providerOrderId,
      paymentId: providerPaymentId,
      signature: sign(providerOrderId, providerPaymentId),
      amount: amountMinor,
      currency,
      isSimulated: true,
    },
    providerMeta: { simulated: true },
  };
};

export const verifyClientSignature = ({ providerOrderId, providerPaymentId, signature }) => {
  if (!providerOrderId || !providerPaymentId || !signature) return false;

  const expected = sign(providerOrderId, providerPaymentId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * There is no gateway to ask, so this reports nothing conclusive on purpose.
 *
 * Returning a hard-coded `captured` here would make any payment id the client
 * invented look settled, which is exactly the "trust the browser" mistake this
 * whole layer exists to prevent. Verification therefore runs only through
 * verifyClientSignature, whose HMAC the simulator alone can produce.
 */
export const fetchPayment = async () => ({
  status: 'unknown',
  amountMinor: null,
  currency: env.payments.currency,
  providerOrderId: '',
  raw: { simulated: true, lookup: 'unsupported' },
  simulated: true,
});

export const verifyWebhook = () => ({ ok: false });

export const refund = async ({ amountMinor }) => ({
  providerRefundId: `sim_rfnd_${crypto.randomBytes(6).toString('hex')}`,
  amountMinor,
});
