import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { Order, Payment } from '../models/index.js';
import { getProvider, adapters } from '../services/payments/index.js';
import { settlePaidOrder, summariseOrder } from './checkout.controller.js';
import env from '../config/env.js';

/**
 * POST /api/payments/confirm
 *
 * Called by the browser when the gateway hands control back. The claim that
 * the payment succeeded is NOT trusted. We either verify the gateway's HMAC
 * server-side, or ask the gateway directly — and in both cases we re-check the
 * amount and currency against our own order before anything is settled.
 */
export const confirmPayment = asyncHandler(async (req, res) => {
  const { orderId, providerOrderId, providerPaymentId, signature } = req.body;

  const order = await Order.findOne({ _id: orderId, customer: req.user._id });
  if (!order) throw ApiError.notFound('That order was not found.');

  const payment = await Payment.findById(order.payment);
  if (!payment) throw ApiError.notFound('No payment was started for that order.');

  // Already settled: return the same answer rather than charging or
  // double-settling. Keeps a refreshed confirmation page harmless.
  if (order.status !== 'pending_payment') {
    res.json({ order: summariseOrder(order), payment: describePayment(payment), alreadySettled: true });
    return;
  }

  const provider = getProvider();
  if (provider.id !== payment.provider) {
    throw ApiError.conflict('This order was started with a different payment provider.');
  }

  // The gateway order id the client echoes must be the one we created.
  if (providerOrderId && payment.providerOrderId && providerOrderId !== payment.providerOrderId) {
    throw ApiError.badRequest('That payment does not belong to this order.');
  }

  let verified = false;
  let verifiedVia = '';

  // 1. Local HMAC check, where the gateway provides one (Razorpay, dev).
  if (provider.verifyClientSignature({ providerOrderId: payment.providerOrderId, providerPaymentId, signature })) {
    verified = true;
    verifiedVia = 'signature';
  }

  // 2. Authoritative check with the gateway itself. Also the only path for
  //    Stripe, which gives the browser no signature to echo.
  let remote = null;
  try {
    remote = await provider.fetchPayment(providerPaymentId);
  } catch (err) {
    console.error('[payments] gateway lookup failed:', err.message);
  }

  if (remote?.status === 'captured') {
    // Amount tampering check: the gateway's captured amount must match ours.
    if (remote.amountMinor != null && remote.amountMinor !== order.totalMinor) {
      payment.status = 'failed';
      payment.failureReason = 'Captured amount did not match the order total.';
      await payment.save();
      throw ApiError.conflict('The paid amount does not match this order. Our team has been alerted.');
    }
    if (remote.currency && remote.currency.toUpperCase() !== order.currency.toUpperCase()) {
      throw ApiError.conflict('The paid currency does not match this order.');
    }
    verified = true;
    verifiedVia = verifiedVia || (provider.id === 'dev' ? 'simulation' : 'signature');
  }

  if (!verified) {
    payment.status = 'failed';
    payment.failureReason = 'Payment could not be verified with the gateway.';
    await payment.save();
    throw ApiError.badRequest(
      'We could not verify that payment with the gateway. If you were charged, nothing has been lost — contact support with your order number.',
    );
  }

  payment.providerPaymentId = providerPaymentId ?? payment.providerPaymentId;
  payment.status = 'captured';
  payment.verifiedAt = new Date();
  payment.verifiedVia = provider.id === 'dev' ? 'simulation' : verifiedVia;
  payment.providerMeta = { ...payment.providerMeta, ...(remote?.raw ?? {}) };
  await payment.save();

  await settlePaidOrder(order, payment, {
    note: provider.id === 'dev' ? 'Simulated payment verified.' : `Payment verified via ${payment.verifiedVia}.`,
  });

  res.json({ order: summariseOrder(order), payment: describePayment(payment) });
});

/** POST /api/payments/cancel — customer abandoned the gateway screen. */
export const cancelPayment = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.body.orderId, customer: req.user._id });
  if (!order) throw ApiError.notFound('That order was not found.');

  if (order.status !== 'pending_payment') {
    throw ApiError.conflict('That order can no longer be cancelled here.');
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancelReason = 'Checkout cancelled before payment.';
  order.history.push({ status: 'cancelled', at: new Date(), by: req.user._id, note: 'Cancelled at checkout.' });
  await order.save();

  if (order.payment) {
    await Payment.updateOne({ _id: order.payment }, { $set: { status: 'cancelled' } });
  }

  // Nothing to restock: stock is only deducted once a payment is verified.
  res.json({ order: summariseOrder(order) });
});

/**
 * POST /api/payments/webhook/:provider
 *
 * The authoritative settlement path. Mounted with a raw body parser so the
 * signature can be computed over the exact bytes the gateway signed, and
 * before any auth middleware — gateways do not carry our session.
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  const adapter = adapters[req.params.provider];
  if (!adapter) {
    res.status(404).json({ received: false, reason: 'unknown provider' });
    return;
  }

  // Only the gateway this server is configured for may settle orders.
  if (req.params.provider !== env.payments.provider) {
    res.status(409).json({ received: false, reason: 'provider not active on this server' });
    return;
  }

  let event;
  try {
    event = await adapter.verifyWebhook({ rawBody: req.body, headers: req.headers });
  } catch (err) {
    console.error('[webhook] verification error:', err.message);
    res.status(400).json({ received: false });
    return;
  }

  if (!event?.ok) {
    // A bad signature is either a misconfiguration or a forgery. Never act.
    console.warn('[webhook] rejected an unverified delivery');
    res.status(400).json({ received: false });
    return;
  }

  // Acknowledge first so the gateway stops retrying, then process. Any error
  // below is ours to fix, not something the gateway should retry forever.
  res.json({ received: true });

  try {
    await processWebhookEvent(event);
  } catch (err) {
    console.error('[webhook] processing failed:', err);
  }
});

const processWebhookEvent = async (event) => {
  if (event.type === 'ignored') return;

  const payment = await Payment.findOne({
    $or: [
      ...(event.providerOrderId ? [{ providerOrderId: event.providerOrderId }] : []),
      ...(event.providerPaymentId ? [{ providerPaymentId: event.providerPaymentId }] : []),
    ],
  });

  if (!payment) {
    console.warn('[webhook] no payment matched', event.providerOrderId, event.providerPaymentId);
    return;
  }

  // Gateways retry; a replayed delivery must not settle twice.
  if (event.eventId && payment.processedEventIds.includes(event.eventId)) return;
  if (event.eventId) {
    payment.processedEventIds.push(event.eventId);
    // Keep the de-duplication list bounded.
    if (payment.processedEventIds.length > 50) payment.processedEventIds.shift();
  }

  const order = await Order.findById(payment.order);
  if (!order) return;

  if (event.type === 'payment_succeeded') {
    if (event.amountMinor && event.amountMinor !== order.totalMinor) {
      payment.status = 'failed';
      payment.failureReason = 'Webhook amount did not match the order total.';
      await payment.save();
      console.error('[webhook] amount mismatch on order', order.orderNumber);
      return;
    }

    payment.providerPaymentId = event.providerPaymentId || payment.providerPaymentId;
    payment.status = 'captured';
    payment.verifiedAt = new Date();
    payment.verifiedVia = 'webhook';
    payment.providerMeta = { ...payment.providerMeta, ...(event.raw ?? {}) };
    await payment.save();

    await settlePaidOrder(order, payment, { note: 'Payment verified via gateway webhook.' });
    return;
  }

  if (event.type === 'payment_failed') {
    payment.status = 'failed';
    payment.failureReason = event.failureReason || 'The gateway reported a failed payment.';
    await payment.save();

    if (order.status === 'pending_payment') {
      order.history.push({ status: 'pending_payment', at: new Date(), note: 'Payment attempt failed.' });
      await order.save();
    }
    return;
  }

  if (event.type === 'refund_succeeded') {
    payment.status = 'refunded';
    payment.refundedAmountMinor = event.amountMinor || payment.amountMinor;
    await payment.save();

    order.status = 'refunded';
    order.history.push({ status: 'refunded', at: new Date(), note: 'Refund confirmed by the gateway.' });
    await order.save();
  }
};

const describePayment = (payment) => ({
  provider: payment.provider,
  status: payment.status,
  amountMinor: payment.amountMinor,
  currency: payment.currency,
  verifiedAt: payment.verifiedAt,
  verifiedVia: payment.verifiedVia,
  isSimulated: payment.provider === 'dev',
});
