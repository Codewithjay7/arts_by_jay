import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { Order, Review, ARTIST_FULFILMENT_TRANSITIONS } from '../models/index.js';
import { readPagination, buildPageMeta } from '../utils/pagination.js';
import { notify } from '../services/notifications.js';

const orderListShape = (order) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  totalMinor: order.totalMinor,
  currency: order.currency,
  itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
  isSimulatedPayment: order.isSimulatedPayment,
  createdAt: order.createdAt,
  paidAt: order.paidAt,
  thumbnails: order.items.slice(0, 4).map((item) => item.imageUrl).filter(Boolean),
});

const orderDetailShape = (order, { reviewableArtworkIds = [] } = {}) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  createdAt: order.createdAt,
  paidAt: order.paidAt,
  cancelledAt: order.cancelledAt,
  cancelReason: order.cancelReason,
  isSimulatedPayment: order.isSimulatedPayment,
  currency: order.currency,
  subtotalMinor: order.subtotalMinor,
  shippingTotalMinor: order.shippingTotalMinor,
  discountMinor: order.discountMinor,
  totalMinor: order.totalMinor,
  shippingAddress: order.shippingAddress,
  billingAddress: order.billingAddress,
  shippingMethod: order.shippingMethod,
  customerNote: order.customerNote,
  history: order.history,
  items: order.items.map((item) => ({
    id: String(item._id),
    artworkId: String(item.artwork),
    title: item.title,
    slug: item.slug,
    imageUrl: item.imageUrl,
    type: item.type,
    medium: item.medium,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
    shippingMinor: item.shippingMinor,
    fulfilmentStatus: item.fulfilmentStatus,
    trackingCarrier: item.trackingCarrier,
    trackingNumber: item.trackingNumber,
    shippedAt: item.shippedAt,
    deliveredAt: item.deliveredAt,
    canReview: reviewableArtworkIds.includes(String(item.artwork)),
  })),
});

/** GET /api/orders — the signed-in customer's own order history. */
export const listMyOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 10 });
  const filter = { customer: req.user._id };

  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);

  res.json({
    items: orders.map(orderListShape),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/** GET /api/orders/:orderNumber — scoped to the caller, by design. */
export const getMyOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, customer: req.user._id });
  if (!order) throw ApiError.notFound('That order was not found.');

  // A buyer may review a piece once it has been delivered and not before.
  const deliveredArtworkIds = order.items
    .filter((item) => item.fulfilmentStatus === 'delivered')
    .map((item) => item.artwork);

  const alreadyReviewed = await Review.find({
    author: req.user._id,
    artwork: { $in: deliveredArtworkIds },
  })
    .select('artwork')
    .lean();

  const reviewedSet = new Set(alreadyReviewed.map((review) => String(review.artwork)));
  const reviewable = deliveredArtworkIds.map(String).filter((id) => !reviewedSet.has(id));

  res.json({ order: orderDetailShape(order, { reviewableArtworkIds: reviewable }) });
});

/** POST /api/orders/:orderNumber/cancel — only before the studio ships. */
export const cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, customer: req.user._id });
  if (!order) throw ApiError.notFound('That order was not found.');

  if (!['pending_payment', 'paid', 'processing'].includes(order.status)) {
    throw ApiError.conflict('This order has already been dispatched and can no longer be cancelled here.');
  }
  if (order.items.some((item) => ['shipped', 'delivered'].includes(item.fulfilmentStatus))) {
    throw ApiError.conflict('Part of this order has already shipped. Please contact support.');
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancelReason = req.body.reason || 'Cancelled by the customer.';
  order.items.forEach((item) => {
    item.fulfilmentStatus = 'cancelled';
  });
  order.history.push({
    status: 'cancelled',
    at: new Date(),
    by: req.user._id,
    note: order.cancelReason,
  });
  await order.save();

  await Promise.all(
    [...new Set(order.items.map((item) => String(item.artistUser)))].map((userId) =>
      notify(userId, {
        type: 'order_status',
        title: `Order ${order.orderNumber} was cancelled`,
        body: 'The collector cancelled this order before dispatch.',
        link: '/artist/orders',
      }),
    ),
  );

  // A paid order that is cancelled needs a refund, which an admin issues
  // through the gateway. We never silently mark money as returned.
  res.json({
    order: orderListShape(order),
    refundRequired: Boolean(order.paidAt),
    refundNote: order.paidAt
      ? 'This order was already paid. A refund must be issued by an administrator through the payment gateway.'
      : '',
  });
});

/** GET /api/artist/orders — order lines belonging to the signed-in artist. */
export const listArtistOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 15 });

  // Only paid-or-later orders are the artist's business; a pending-payment
  // order is not yet a sale.
  const filter = {
    'items.artistUser': req.user._id,
    status: { $in: ['paid', 'processing', 'shipped', 'delivered', 'refunded', 'cancelled'] },
  };

  if (req.query.fulfilmentStatus) {
    filter['items.fulfilmentStatus'] = req.query.fulfilmentStatus;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  // Strip other artists' line items out before responding.
  const items = orders.map((order) => {
    const mine = order.items.filter((item) => String(item.artistUser) === String(req.user._id));
    return {
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      currency: order.currency,
      isSimulatedPayment: order.isSimulatedPayment,
      shipTo: {
        fullName: order.shippingAddress?.fullName,
        city: order.shippingAddress?.city,
        state: order.shippingAddress?.state,
        postalCode: order.shippingAddress?.postalCode,
        country: order.shippingAddress?.country,
      },
      myTotalMinor: mine.reduce((sum, item) => sum + item.lineTotalMinor, 0),
      myEarningsMinor: mine.reduce((sum, item) => sum + item.earningsMinor, 0),
      items: mine.map((item) => ({
        id: String(item._id),
        title: item.title,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.lineTotalMinor,
        earningsMinor: item.earningsMinor,
        fulfilmentStatus: item.fulfilmentStatus,
        trackingCarrier: item.trackingCarrier,
        trackingNumber: item.trackingNumber,
        allowedNext: ARTIST_FULFILMENT_TRANSITIONS[item.fulfilmentStatus] ?? [],
      })),
    };
  });

  res.json({ items, meta: buildPageMeta({ page, limit, total }) });
});

/**
 * PATCH /api/artist/orders/:orderId/items/:itemId
 *
 * An artist may only move their own line items, and only along the permitted
 * transitions in ARTIST_FULFILMENT_TRANSITIONS. Ownership and the transition
 * are both enforced here on the server.
 */
export const updateArtistOrderItem = asyncHandler(async (req, res) => {
  const { fulfilmentStatus, trackingCarrier, trackingNumber } = req.body;

  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound('That order was not found.');

  const item = order.items.id(req.params.itemId);
  if (!item) throw ApiError.notFound('That order item was not found.');

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && String(item.artistUser) !== String(req.user._id)) {
    throw ApiError.forbidden('That order item does not belong to you.');
  }
  if (!['paid', 'processing', 'shipped', 'delivered'].includes(order.status)) {
    throw ApiError.conflict('This order is not in a state that can be fulfilled.');
  }

  if (fulfilmentStatus && fulfilmentStatus !== item.fulfilmentStatus) {
    const allowed = ARTIST_FULFILMENT_TRANSITIONS[item.fulfilmentStatus] ?? [];
    if (!isAdmin && !allowed.includes(fulfilmentStatus)) {
      throw ApiError.badRequest(
        `An order item cannot move from "${item.fulfilmentStatus}" to "${fulfilmentStatus}".`,
      );
    }

    item.fulfilmentStatus = fulfilmentStatus;
    if (fulfilmentStatus === 'shipped') item.shippedAt = new Date();
    if (fulfilmentStatus === 'delivered') item.deliveredAt = new Date();

    item.history.push({ status: fulfilmentStatus, at: new Date(), by: req.user._id, note: req.body.note ?? '' });
  }

  if (trackingCarrier !== undefined) item.trackingCarrier = trackingCarrier;
  if (trackingNumber !== undefined) item.trackingNumber = trackingNumber;

  // The order's own status follows from its line items.
  const statuses = order.items.map((entry) => entry.fulfilmentStatus);
  if (statuses.every((status) => status === 'delivered')) order.status = 'delivered';
  else if (statuses.some((status) => status === 'shipped')) order.status = 'shipped';
  else if (statuses.some((status) => status === 'preparing')) order.status = 'processing';

  order.history.push({
    status: order.status,
    at: new Date(),
    by: req.user._id,
    note: `"${item.title}" marked ${item.fulfilmentStatus}.`,
  });

  await order.save();

  await notify(order.customer, {
    type: 'order_status',
    title: `Update on order ${order.orderNumber}`,
    body: `"${item.title}" is now ${item.fulfilmentStatus}.`,
    link: `/account/orders/${order.orderNumber}`,
  });

  res.json({
    item: {
      id: String(item._id),
      fulfilmentStatus: item.fulfilmentStatus,
      trackingCarrier: item.trackingCarrier,
      trackingNumber: item.trackingNumber,
      allowedNext: ARTIST_FULFILMENT_TRANSITIONS[item.fulfilmentStatus] ?? [],
    },
    orderStatus: order.status,
  });
});
