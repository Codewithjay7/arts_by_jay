import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import {
  User,
  ArtistProfile,
  Artwork,
  Category,
  Order,
  Payment,
  Review,
  CommissionRequest,
} from '../models/index.js';
import { readPagination, buildPageMeta } from '../utils/pagination.js';
import { toCard, escapeRegex } from '../services/artworkQuery.js';
import { notify } from '../services/notifications.js';
import { revokeAllForUser } from '../services/tokens.js';
import { refreshArtistArtworkCount } from './artist.controller.js';
import { getProvider } from '../services/payments/index.js';

/* ──────────────────────────── Overview ──────────────────────────── */

/** GET /api/admin/overview — marketplace statistics and activity. */
export const getOverview = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    userCounts,
    artistCounts,
    artworkCounts,
    orderCounts,
    revenueAgg,
    recentRevenueAgg,
    pendingArtworks,
    pendingArtists,
    reportedArtworks,
    openEnquiries,
    recentOrders,
    simulatedOrderCount,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ArtistProfile.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Artwork.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
      {
        $group: {
          _id: null,
          grossMinor: { $sum: '$totalMinor' },
          commissionMinor: { $sum: { $sum: '$items.commissionMinor' } },
          count: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] }, createdAt: { $gte: since } } },
      { $group: { _id: null, grossMinor: { $sum: '$totalMinor' }, count: { $sum: 1 } } },
    ]),
    Artwork.countDocuments({ status: 'pending' }),
    ArtistProfile.countDocuments({ status: 'pending' }),
    Artwork.countDocuments({ 'moderation.reportCount': { $gt: 0 } }),
    CommissionRequest.countDocuments({ status: { $in: ['new', 'in_review'] } }),
    Order.find({ status: { $ne: 'pending_payment' } })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('orderNumber status totalMinor currency createdAt customerEmail isSimulatedPayment')
      .lean(),
    Order.countDocuments({ isSimulatedPayment: true }),
  ]);

  const revenue = revenueAgg[0] ?? { grossMinor: 0, commissionMinor: 0, count: 0 };
  const recent = recentRevenueAgg[0] ?? { grossMinor: 0, count: 0 };

  res.json({
    users: {
      ...Object.fromEntries(userCounts.map((row) => [row._id, row.count])),
      total: userCounts.reduce((sum, row) => sum + row.count, 0),
    },
    artists: Object.fromEntries(artistCounts.map((row) => [row._id, row.count])),
    artworks: {
      ...Object.fromEntries(artworkCounts.map((row) => [row._id, row.count])),
      total: artworkCounts.reduce((sum, row) => sum + row.count, 0),
    },
    orders: {
      ...Object.fromEntries(orderCounts.map((row) => [row._id, row.count])),
      total: orderCounts.reduce((sum, row) => sum + row.count, 0),
    },
    revenue: {
      grossMinor: revenue.grossMinor,
      commissionMinor: revenue.commissionMinor,
      payableMinor: revenue.grossMinor - revenue.commissionMinor,
      paidOrderCount: revenue.count,
      last30DaysGrossMinor: recent.grossMinor,
      last30DaysOrderCount: recent.count,
      currency: env.payments.currency,
      commissionPercent: env.payments.commissionPercent,
    },
    queues: { pendingArtworks, pendingArtists, reportedArtworks, openEnquiries },
    recentOrders,
    // Surfaced so an admin is never misled by simulated sales in the numbers.
    integrity: {
      paymentProvider: env.payments.provider,
      isSimulatedGateway: env.payments.provider === 'dev',
      simulatedOrderCount,
    },
  });
});

/* ─────────────────────────── User management ─────────────────────────── */

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  if (req.query.q) {
    const pattern = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    items: users.map((user) => ({ ...user.toPublic(), lastLoginAt: user.lastLoginAt, suspendedReason: user.suspendedReason })),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/** PATCH /api/admin/users/:id — suspend, reinstate or change a role. */
export const updateUser = asyncHandler(async (req, res) => {
  const { isActive, role, suspendedReason } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('That user was not found.');

  // An admin must not lock themselves out or demote their own account.
  if (String(user._id) === String(req.user._id) && (isActive === false || (role && role !== 'admin'))) {
    throw ApiError.badRequest('You cannot suspend or demote your own administrator account.');
  }

  if (role && role !== user.role) {
    if (role === 'artist' && !(await ArtistProfile.exists({ user: user._id }))) {
      await ArtistProfile.create({ user: user._id, displayName: user.name, status: 'pending' });
    }
    user.role = role;
    // Role changes invalidate existing sessions so the new role takes effect.
    user.tokenVersion += 1;
    await revokeAllForUser(user._id);
  }

  if (isActive !== undefined && isActive !== user.isActive) {
    user.isActive = isActive;
    user.suspendedReason = isActive ? '' : (suspendedReason ?? 'Suspended by an administrator.');
    if (!isActive) {
      user.tokenVersion += 1;
      await revokeAllForUser(user._id);
    }

    await notify(user._id, {
      type: 'account_notice',
      title: isActive ? 'Your account has been reinstated' : 'Your account has been suspended',
      body: isActive ? 'You can sign in and trade again.' : user.suspendedReason,
      link: '/account/profile',
    });
  }

  await user.save();
  res.json({ user: { ...user.toPublic(), suspendedReason: user.suspendedReason } });
});

/* ────────────────────────── Artist applications ─────────────────────── */

export const listArtistApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [profiles, total] = await Promise.all([
    ArtistProfile.find(filter)
      .populate('user', 'name email createdAt isActive')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ArtistProfile.countDocuments(filter),
  ]);

  res.json({
    items: profiles.map((profile) => ({
      id: String(profile._id),
      displayName: profile.displayName,
      slug: profile.slug,
      status: profile.status,
      bio: profile.bio,
      location: profile.location,
      avatarUrl: profile.avatarUrl,
      specialities: profile.specialities,
      links: profile.links,
      stats: profile.stats,
      reviewNote: profile.reviewNote,
      createdAt: profile.createdAt,
      user: profile.user
        ? { id: String(profile.user._id), name: profile.user.name, email: profile.user.email, isActive: profile.user.isActive }
        : null,
    })),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/** POST /api/admin/artists/:id/review — approve, reject or suspend. */
export const reviewArtistApplication = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;

  const profile = await ArtistProfile.findById(req.params.id);
  if (!profile) throw ApiError.notFound('That artist profile was not found.');

  profile.status = decision;
  profile.reviewedAt = new Date();
  profile.reviewedBy = req.user._id;
  profile.reviewNote = note ?? '';
  await profile.save();

  if (decision !== 'approved') {
    // A suspended or rejected artist's live work comes off the storefront.
    await Artwork.updateMany(
      { artist: profile._id, status: 'published' },
      { $set: { status: 'unpublished' } },
    );
    await refreshArtistArtworkCount(profile._id);
  }

  await notify(profile.user, {
    type: decision === 'approved' ? 'artist_approved' : 'artist_rejected',
    title:
      decision === 'approved'
        ? 'Your artist application was approved'
        : decision === 'rejected'
          ? 'Your artist application was not approved'
          : 'Your artist account has been suspended',
    body: note || (decision === 'approved' ? 'You can now publish and sell your work.' : ''),
    link: '/artist/storefront',
  });

  res.json({ profile: { id: String(profile._id), status: profile.status, reviewNote: profile.reviewNote } });
});

/* ───────────────────────── Artwork moderation ───────────────────────── */

export const listArtworksForModeration = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.reported === 'true') filter['moderation.reportCount'] = { $gt: 0 };
  if (req.query.q) filter.title = new RegExp(escapeRegex(req.query.q), 'i');

  const [artworks, total] = await Promise.all([
    Artwork.find(filter)
      .populate('artist', 'displayName slug status')
      .populate('category', 'name slug')
      .sort({ status: 1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Artwork.countDocuments(filter),
  ]);

  res.json({
    items: artworks.map((artwork) => ({
      ...toCard(artwork),
      status: artwork.status,
      description: artwork.description,
      moderation: artwork.moderation,
      createdAt: artwork.createdAt,
      updatedAt: artwork.updatedAt,
    })),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/** POST /api/admin/artworks/:id/moderate */
export const moderateArtwork = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;

  const artwork = await Artwork.findById(req.params.id).populate('artist', 'user status displayName');
  if (!artwork) throw ApiError.notFound('That artwork was not found.');

  if (decision === 'approve') {
    if (artwork.artist?.status !== 'approved') {
      throw ApiError.conflict('Approve the artist account before publishing their work.');
    }
    artwork.status = 'published';
    artwork.publishedAt = artwork.publishedAt ?? new Date();
    artwork.moderation.reportCount = 0;
  } else if (decision === 'reject') {
    artwork.status = 'rejected';
  } else if (decision === 'unpublish') {
    artwork.status = 'unpublished';
  } else if (decision === 'feature') {
    artwork.isFeatured = !artwork.isFeatured;
  }

  artwork.moderation.reviewedAt = new Date();
  artwork.moderation.reviewedBy = req.user._id;
  artwork.moderation.note = note ?? '';
  await artwork.save();
  await refreshArtistArtworkCount(artwork.artist?._id ?? artwork.artist);

  if (['approve', 'reject', 'unpublish'].includes(decision) && artwork.artist?.user) {
    await notify(artwork.artist.user, {
      type: decision === 'approve' ? 'artwork_approved' : 'artwork_rejected',
      title:
        decision === 'approve'
          ? `"${artwork.title}" is now live`
          : `"${artwork.title}" was ${decision === 'reject' ? 'not approved' : 'unpublished'}`,
      body: note || '',
      link: '/artist/artworks',
    });
  }

  res.json({ artwork: { id: String(artwork._id), status: artwork.status, isFeatured: artwork.isFeatured } });
});

/* ──────────────────────────── Categories ──────────────────────────── */

export const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  res.status(201).json({ category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('That category was not found.');

  Object.assign(category, req.body);
  await category.save();
  res.json({ category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const inUse = await Artwork.countDocuments({ category: req.params.id });
  if (inUse > 0) {
    throw ApiError.conflict(`${inUse} artwork${inUse === 1 ? '' : 's'} still use that category.`);
  }

  const hasChildren = await Category.exists({ parent: req.params.id });
  if (hasChildren) throw ApiError.conflict('Remove or re-parent the sub-categories first.');

  const result = await Category.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) throw ApiError.notFound('That category was not found.');

  res.json({ ok: true });
});

/* ──────────────────────────── Orders & refunds ────────────────────────── */

export const listAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const pattern = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ orderNumber: pattern }, { customerEmail: pattern }];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  res.json({
    items: orders.map((order) => ({
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      customerEmail: order.customerEmail,
      totalMinor: order.totalMinor,
      currency: order.currency,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      isSimulatedPayment: order.isSimulatedPayment,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    })),
    meta: buildPageMeta({ page, limit, total }),
  });
});

export const getOrderForAdmin = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber })
    .populate('customer', 'name email')
    .populate('payment')
    .lean();

  if (!order) throw ApiError.notFound('That order was not found.');
  res.json({ order });
});

/**
 * POST /api/admin/orders/:orderNumber/refund
 *
 * Issues a real refund through the gateway. If the gateway call fails nothing
 * is marked as refunded — we never record money as returned unless it was.
 */
export const refundOrder = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  const order = await Order.findOne({ orderNumber: req.params.orderNumber });
  if (!order) throw ApiError.notFound('That order was not found.');
  if (!order.paidAt) throw ApiError.conflict('That order was never paid, so there is nothing to refund.');
  if (order.status === 'refunded') throw ApiError.conflict('That order has already been refunded.');

  const payment = await Payment.findById(order.payment);
  if (!payment?.providerPaymentId) {
    throw ApiError.conflict('No captured gateway payment is recorded for that order.');
  }

  const provider = getProvider();
  const amountMinor = amount == null ? payment.amountMinor - payment.refundedAmountMinor : Math.round(amount * 100);

  if (amountMinor <= 0 || amountMinor > payment.amountMinor - payment.refundedAmountMinor) {
    throw ApiError.badRequest('That refund amount is not valid for this payment.');
  }

  let result;
  try {
    result = await provider.refund({
      providerPaymentId: payment.providerPaymentId,
      amountMinor,
      reason: reason ?? '',
    });
  } catch (err) {
    console.error('[admin] refund failed:', err);
    throw new ApiError(502, 'The payment gateway rejected the refund. Nothing has been changed.');
  }

  payment.refunds.push({
    providerRefundId: result.providerRefundId,
    amountMinor: result.amountMinor,
    reason: reason ?? '',
  });
  payment.refundedAmountMinor += result.amountMinor;
  if (payment.refundedAmountMinor >= payment.amountMinor) payment.status = 'refunded';
  await payment.save();

  if (payment.refundedAmountMinor >= payment.amountMinor) {
    order.status = 'refunded';
    order.history.push({ status: 'refunded', at: new Date(), by: req.user._id, note: reason ?? 'Refunded in full.' });
    await order.save();
  }

  await notify(order.customer, {
    type: 'order_status',
    title: `Refund issued for order ${order.orderNumber}`,
    body: reason || 'Your refund has been sent back to the original payment method.',
    link: `/account/orders/${order.orderNumber}`,
  });

  res.json({
    refundedAmountMinor: payment.refundedAmountMinor,
    paymentStatus: payment.status,
    orderStatus: order.status,
    isSimulated: payment.provider === 'dev',
  });
});

/* ───────────────────────────── Reports ───────────────────────────── */

/** GET /api/admin/reports/sales — sales and commission by day and by artist. */
export const getSalesReport = asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(7, Number.parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const paidStatuses = ['paid', 'processing', 'shipped', 'delivered'];

  const [byDay, byArtist, byCategory] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: paidStatuses }, paidAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          grossMinor: { $sum: '$totalMinor' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { status: { $in: paidStatuses }, paidAt: { $gte: since } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.artist',
          grossMinor: { $sum: '$items.lineTotalMinor' },
          commissionMinor: { $sum: '$items.commissionMinor' },
          earningsMinor: { $sum: '$items.earningsMinor' },
          units: { $sum: '$items.quantity' },
        },
      },
      { $sort: { grossMinor: -1 } },
      { $limit: 20 },
      { $lookup: { from: 'artistprofiles', localField: '_id', foreignField: '_id', as: 'artist' } },
      { $unwind: { path: '$artist', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          grossMinor: 1,
          commissionMinor: 1,
          earningsMinor: 1,
          units: 1,
          displayName: '$artist.displayName',
          slug: '$artist.slug',
        },
      },
    ]),
    Order.aggregate([
      { $match: { status: { $in: paidStatuses }, paidAt: { $gte: since } } },
      { $unwind: '$items' },
      { $lookup: { from: 'artworks', localField: 'items.artwork', foreignField: '_id', as: 'artwork' } },
      { $unwind: { path: '$artwork', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$artwork.category',
          grossMinor: { $sum: '$items.lineTotalMinor' },
          units: { $sum: '$items.quantity' },
        },
      },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      { $project: { grossMinor: 1, units: 1, name: '$category.name', slug: '$category.slug' } },
      { $sort: { grossMinor: -1 } },
    ]),
  ]);

  res.json({
    days,
    currency: env.payments.currency,
    commissionPercent: env.payments.commissionPercent,
    byDay: byDay.map((row) => ({ date: row._id, grossMinor: row.grossMinor, orders: row.orders })),
    byArtist,
    byCategory,
    note:
      env.payments.provider === 'dev'
        ? 'This server uses the simulated payment gateway, so these figures include orders where no money moved.'
        : '',
  });
});

/** GET /api/admin/settings — read-only view of how the server is configured. */
export const getPlatformSettings = asyncHandler(async (_req, res) => {
  res.json({
    environment: env.nodeEnv,
    payments: {
      provider: env.payments.provider,
      currency: env.payments.currency,
      commissionPercent: env.payments.commissionPercent,
      isSimulated: env.payments.provider === 'dev',
    },
    storage: { driver: env.storage.driver, maxUploadMb: env.storage.maxUploadMb },
    features: {
      aiPhotoStudio: Boolean(env.ai.provider),
      emailDelivery: Boolean(env.mail.smtpUrl),
      inMemoryDatabase: env.db.useMemory,
    },
    // These are environment values; they are deliberately not editable over
    // the API, so a compromised admin session cannot reconfigure payments.
    note: 'Platform settings are controlled by server environment variables and cannot be changed from this dashboard.',
  });
});

/* ───────────────────────── Content moderation ───────────────────────── */

export const hideReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('That review was not found.');

  review.isHidden = req.body.isHidden ?? true;
  review.hiddenReason = req.body.reason ?? '';
  await review.save();

  await recalculateArtworkRating(review.artwork);
  res.json({ review: { id: String(review._id), isHidden: review.isHidden } });
});

export const recalculateArtworkRating = async (artworkId) => {
  const [agg] = await Review.aggregate([
    { $match: { artwork: artworkId, isHidden: false } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Artwork.updateOne(
    { _id: artworkId },
    {
      $set: {
        'stats.ratingAverage': Math.round((agg?.average ?? 0) * 10) / 10,
        'stats.ratingCount': agg?.count ?? 0,
      },
    },
  );
};
