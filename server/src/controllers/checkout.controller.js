import mongoose from 'mongoose';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { supportsTransactions } from '../config/db.js';
import { Cart, Order, Payment, Artwork, ArtistProfile, generateOrderNumber } from '../models/index.js';
import { priceCart, SHIPPING_METHODS } from '../services/pricing.js';
import { getProvider, describePaymentCapability } from '../services/payments/index.js';
import { notify } from '../services/notifications.js';
import { toCard } from '../services/artworkQuery.js';

const CART_POPULATE = {
  path: 'items.artwork',
  populate: [{ path: 'artist', select: 'displayName slug user' }],
};

/** GET /api/checkout/config — what the client may assume about payments. */
export const getCheckoutConfig = asyncHandler(async (_req, res) => {
  res.json({
    payment: describePaymentCapability(),
    shippingMethods: SHIPPING_METHODS,
    commissionPercent: env.payments.commissionPercent,
  });
});

const BLOCKING_ISSUES = ['sold_out', 'unavailable', 'removed', 'commission_only'];

/**
 * GET /api/checkout/review — authoritative re-validation before payment.
 * Everything the customer is about to be charged is computed here, from the
 * database, never from the request.
 */
export const reviewCheckout = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).populate(CART_POPULATE);
  if (!cart || !cart.items.length) throw ApiError.badRequest('Your cart is empty.');

  const priced = priceCart(cart, { shippingMethod: req.query.shippingMethod ?? 'standard' });

  res.json({
    items: priced.lines.map((line) => ({
      artwork: toCard(line.artwork),
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      shippingMinor: line.shippingMinor,
    })),
    totals: {
      subtotalMinor: priced.subtotalMinor,
      shippingTotalMinor: priced.shippingTotalMinor,
      discountMinor: priced.discountMinor,
      totalMinor: priced.totalMinor,
      currency: priced.currency,
      itemCount: priced.itemCount,
    },
    issues: priced.issues,
    // The client must not let the customer pay while a blocking issue stands.
    canProceed:
      priced.lines.length > 0 && !priced.issues.some((issue) => BLOCKING_ISSUES.includes(issue.kind)),
    payment: describePaymentCapability(),
  });
});

export const summariseOrder = (order) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  totalMinor: order.totalMinor,
  subtotalMinor: order.subtotalMinor,
  shippingTotalMinor: order.shippingTotalMinor,
  currency: order.currency,
  itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
  isSimulatedPayment: order.isSimulatedPayment,
  createdAt: order.createdAt,
});

/**
 * POST /api/checkout — creates a `pending_payment` order and a gateway intent.
 *
 * No stock is deducted and no sale is recorded here. That happens only once
 * the payment has been verified server-side.
 */
export const createCheckout = asyncHandler(async (req, res) => {
  const provider = getProvider(); // throws a clear 503 when payments are off

  const { shippingAddress, billingAddress, shippingMethod, customerNote, idempotencyKey } = req.body;

  // A double-submitted checkout returns the original order, never a second one.
  if (idempotencyKey) {
    const existing = await Order.findOne({ idempotencyKey, customer: req.user._id });
    if (existing) {
      const payment = existing.payment ? await Payment.findById(existing.payment) : null;
      res.json({
        order: summariseOrder(existing),
        payment: payment
          ? {
              provider: payment.provider,
              providerOrderId: payment.providerOrderId,
              amountMinor: payment.amountMinor,
              currency: payment.currency,
              isSimulated: payment.provider === 'dev',
            }
          : null,
        reused: true,
      });
      return;
    }
  }

  const cart = await Cart.findOne({ user: req.user._id }).populate(CART_POPULATE);
  if (!cart || !cart.items.length) throw ApiError.badRequest('Your cart is empty.');

  const priced = priceCart(cart, { shippingMethod });

  if (!priced.lines.length) {
    throw ApiError.conflict('None of the items in your cart can be purchased right now.', {
      code: 'CART_CHANGED',
      details: { issues: priced.issues },
    });
  }

  if (priced.issues.some((issue) => BLOCKING_ISSUES.includes(issue.kind))) {
    throw ApiError.conflict(
      'Your cart changed since you last reviewed it. Please check the highlighted items.',
      { code: 'CART_CHANGED', details: { issues: priced.issues } },
    );
  }

  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    customer: req.user._id,
    customerEmail: req.user.email,
    items: priced.lines.map((line) => ({
      artwork: line.artwork._id,
      artist: line.artwork.artist?._id ?? line.artwork.artist,
      artistUser: line.artwork.artist?.user ?? line.artwork.owner,
      title: line.artwork.title,
      slug: line.artwork.slug,
      imageUrl: line.artwork.images?.[0]?.url ?? '',
      type: line.artwork.type,
      medium: line.artwork.medium,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      shippingMinor: line.shippingMinor,
      // Snapshot: a later change to the platform rate must never rewrite what
      // this artist was owed on this sale.
      commissionRatePercent: line.commissionRatePercent,
      commissionBasisMinor: line.commissionBasisMinor,
      commissionMinor: line.commissionMinor,
      earningsMinor: line.earningsMinor,
      history: [{ status: 'awaiting', at: new Date(), by: req.user._id, note: 'Order created.' }],
    })),
    subtotalMinor: priced.subtotalMinor,
    shippingTotalMinor: priced.shippingTotalMinor,
    discountMinor: priced.discountMinor,
    totalMinor: priced.totalMinor,
    currency: priced.currency,
    shippingAddress,
    billingAddress: billingAddress ?? null,
    shippingMethod: priced.shippingMethod,
    customerNote: customerNote ?? '',
    status: 'pending_payment',
    isSimulatedPayment: provider.id === 'dev',
    idempotencyKey: idempotencyKey ?? undefined,
    history: [{ status: 'pending_payment', at: new Date(), by: req.user._id, note: 'Awaiting payment.' }],
  });

  let intent;
  try {
    intent = await provider.createIntent({
      order,
      amountMinor: order.totalMinor,
      currency: order.currency,
    });
  } catch (err) {
    // Do not leave an orphan order behind when the gateway refused us.
    await Order.deleteOne({ _id: order._id });
    if (err instanceof ApiError) throw err;
    console.error('[checkout] gateway intent failed:', err);
    throw new ApiError(502, 'The payment gateway could not start this payment. Nothing has been charged.');
  }

  const payment = await Payment.create({
    order: order._id,
    customer: req.user._id,
    provider: provider.id,
    providerOrderId: intent.providerOrderId,
    amountMinor: order.totalMinor,
    currency: order.currency,
    status: 'pending',
    providerMeta: intent.providerMeta ?? {},
  });

  order.payment = payment._id;
  await order.save();

  res.status(201).json({
    order: summariseOrder(order),
    payment: {
      provider: provider.id,
      isSimulated: provider.id === 'dev',
      amountMinor: order.totalMinor,
      currency: order.currency,
      ...intent.clientPayload,
    },
  });
});

/**
 * Settles a verified payment: deducts stock, records the sale, credits artist
 * earnings and empties the cart.
 *
 * Idempotent by design. A replayed webhook and a client-side confirm both land
 * here, and the `pending_payment` guard means only the first one does the work.
 *
 * Uses a transaction when the deployment supports one (replica set or Atlas)
 * and falls back to sequential writes on a standalone mongod.
 */
export const settlePaidOrder = async (order, _payment, { note = 'Payment verified.' } = {}) => {
  if (order.status !== 'pending_payment') return order;

  // Transaction support is probed once at connect time; a standalone mongod
  // accepts startTransaction() and only fails on the first write inside it.
  const useTransaction = supportsTransactions();
  const session = useTransaction ? await mongoose.startSession() : null;

  if (useTransaction) session.startTransaction();
  const opts = useTransaction ? { session } : {};

  try {
    for (const item of order.items) {
      // eslint-disable-next-line no-await-in-loop
      const artwork = await Artwork.findById(item.artwork).session(useTransaction ? session : null);
      if (!artwork) continue;

      const digital = Boolean(artwork.shipping?.isDigitalDelivery);
      if (!digital) {
        artwork.stock = Math.max(0, artwork.stock - item.quantity);
        // A one-of-a-kind piece that has just sold leaves the shop for good.
        if (artwork.stock === 0 && artwork.isUnique) artwork.status = 'unpublished';
      }
      artwork.stats.unitsSold += item.quantity;
      // eslint-disable-next-line no-await-in-loop
      await artwork.save(opts);
    }

    order.status = 'paid';
    order.paidAt = new Date();
    order.history.push({ status: 'paid', at: new Date(), note });
    await order.save(opts);

    await Cart.updateOne({ user: order.customer }, { $set: { items: [] } }, opts);

    if (useTransaction) await session.commitTransaction();
  } catch (err) {
    if (useTransaction) await session.abortTransaction();
    throw err;
  } finally {
    if (session) await session.endSession();
  }

  // Counters and notifications sit deliberately outside the money path: a
  // failure here must never undo an order that is already settled.
  await creditArtists(order).catch((err) => console.error('[checkout] crediting artists failed:', err));
  await announceOrder(order).catch((err) => console.error('[checkout] notifications failed:', err));

  return order;
};

const creditArtists = async (order) => {
  const byArtist = new Map();

  order.items.forEach((item) => {
    const key = String(item.artist);
    const entry = byArtist.get(key) ?? { earnings: 0, units: 0 };
    entry.earnings += item.earningsMinor;
    entry.units += item.quantity;
    byArtist.set(key, entry);
  });

  await Promise.all(
    [...byArtist.entries()].map(([artistId, entry]) =>
      ArtistProfile.updateOne(
        { _id: artistId },
        {
          $inc: {
            'stats.totalSales': entry.units,
            'stats.lifetimeEarningsMinor': entry.earnings,
            'stats.pendingEarningsMinor': entry.earnings,
          },
        },
      ),
    ),
  );
};

const announceOrder = async (order) => {
  const simulated = order.isSimulatedPayment ? ' (simulated payment)' : '';

  await notify(order.customer, {
    type: 'order_paid',
    title: `Order ${order.orderNumber} confirmed${simulated}`,
    body: 'Thank you. Your order is confirmed and the studio has been notified.',
    link: `/account/orders/${order.orderNumber}`,
  });

  const artistUsers = [...new Set(order.items.map((item) => String(item.artistUser)))];

  await Promise.all(
    artistUsers.map((userId) =>
      notify(userId, {
        type: 'order_placed',
        title: `New sale on order ${order.orderNumber}${simulated}`,
        body: 'A collector has purchased your work. Please prepare it for dispatch.',
        link: '/artist/orders',
      }),
    ),
  );
};
