import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import {
  Category,
  Artwork,
  Review,
  Order,
  Notification,
  CommissionRequest,
  ArtistProfile,
  generateCommissionReference,
} from '../models/index.js';
import { readPagination, buildPageMeta } from '../utils/pagination.js';
import { storeImage } from '../services/storage.js';
import { notify } from '../services/notifications.js';
import { recalculateArtworkRating } from './admin.controller.js';
import { toMinor } from '../utils/money.js';

/* ──────────────────────────── Categories ──────────────────────────── */

/** GET /api/categories — the public category tree. */
export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 }).lean();

  const counts = await Artwork.aggregate([
    { $match: { status: 'published' } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]));

  const shape = (category) => ({
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    description: category.description,
    imageUrl: category.imageUrl,
    isFeatured: category.isFeatured,
    artworkCount: countMap.get(String(category._id)) ?? 0,
    children: [],
  });

  const byId = new Map(categories.map((category) => [String(category._id), shape(category)]));
  const roots = [];

  categories.forEach((category) => {
    const node = byId.get(String(category._id));
    if (category.parent && byId.has(String(category.parent))) {
      byId.get(String(category.parent)).children.push(node);
    } else {
      roots.push(node);
    }
  });

  // A parent's count includes everything hanging beneath it.
  roots.forEach((root) => {
    root.artworkCount += root.children.reduce((sum, child) => sum + child.artworkCount, 0);
  });

  res.json({ items: roots, flat: [...byId.values()] });
});

/* ───────────────────────────── Reviews ───────────────────────────── */

/**
 * POST /api/reviews
 *
 * Only a buyer whose order actually contains the piece, and whose line item is
 * delivered, may review it. That is enforced here rather than hidden in the UI.
 */
export const createReview = asyncHandler(async (req, res) => {
  const { artworkId, rating, title, body } = req.body;

  const order = await Order.findOne({
    customer: req.user._id,
    'items.artwork': artworkId,
    'items.fulfilmentStatus': 'delivered',
  });

  if (!order) {
    throw ApiError.forbidden('You can review a piece once your order for it has been delivered.');
  }

  if (await Review.exists({ artwork: artworkId, author: req.user._id })) {
    throw ApiError.conflict('You have already reviewed this piece.');
  }

  const artwork = await Artwork.findById(artworkId).populate('artist', 'user displayName');
  if (!artwork) throw ApiError.notFound('That artwork was not found.');

  const review = await Review.create({
    artwork: artworkId,
    author: req.user._id,
    order: order._id,
    rating,
    title: title ?? '',
    body: body ?? '',
    isVerifiedPurchase: true,
  });

  await recalculateArtworkRating(artwork._id);

  if (artwork.artist?.user) {
    await notify(artwork.artist.user, {
      type: 'review_received',
      title: `New ${rating}-star review on "${artwork.title}"`,
      body: title || body || '',
      link: `/art/${artwork.slug}`,
    });
  }

  res.status(201).json({
    review: {
      id: String(review._id),
      rating: review.rating,
      title: review.title,
      body: review.body,
      createdAt: review.createdAt,
    },
  });
});

export const listMyReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ author: req.user._id })
    .populate('artwork', 'title slug images')
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    items: reviews.map((review) => ({
      id: String(review._id),
      rating: review.rating,
      title: review.title,
      body: review.body,
      createdAt: review.createdAt,
      isHidden: review.isHidden,
      artwork: review.artwork
        ? {
            id: String(review.artwork._id),
            title: review.artwork.title,
            slug: review.artwork.slug,
            image: review.artwork.images?.[0]?.thumbUrl || review.artwork.images?.[0]?.url || '',
          }
        : null,
    })),
  });
});

export const deleteMyReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, author: req.user._id });
  if (!review) throw ApiError.notFound('That review was not found.');

  const artworkId = review.artwork;
  await review.deleteOne();
  await recalculateArtworkRating(artworkId);

  res.json({ ok: true });
});

/* ───────────────────── Commissions and enquiries ───────────────────── */

const commissionShape = (request) => ({
  id: String(request._id),
  reference: request.reference,
  kind: request.kind,
  status: request.status,
  subject: request.subject,
  message: request.message,
  contactName: request.contactName,
  contactEmail: request.contactEmail,
  contactPhone: request.contactPhone,
  styleKey: request.styleKey,
  preferredSize: request.preferredSize,
  budgetMinor: request.budgetMinor,
  deadline: request.deadline,
  quotedAmountMinor: request.quotedAmountMinor,
  quoteNote: request.quoteNote,
  referenceImages: request.referenceImages ?? [],
  photoConsent: request.photoConsent,
  messages: request.messages ?? [],
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  artist: request.artist?.displayName
    ? { id: String(request.artist._id), displayName: request.artist.displayName, slug: request.artist.slug }
    : null,
  artwork: request.artwork?.title
    ? { id: String(request.artwork._id), title: request.artwork.title, slug: request.artwork.slug }
    : null,
});

/** POST /api/commissions — commission request, artwork enquiry or studio brief. */
export const createCommissionRequest = asyncHandler(async (req, res) => {
  const body = req.body;

  let artistProfile = null;
  if (body.artistId) {
    artistProfile = await ArtistProfile.findOne({ _id: body.artistId, status: 'approved' });
    if (!artistProfile) throw ApiError.notFound('That artist was not found.');
  }

  let artwork = null;
  if (body.artworkId) {
    artwork = await Artwork.findById(body.artworkId).populate('artist', '_id user displayName status');
    if (!artwork) throw ApiError.notFound('That artwork was not found.');
    // An enquiry about a listing goes to that listing's artist.
    artistProfile = artistProfile ?? artwork.artist;
  }

  // Reference photos are only kept when consent was explicitly given.
  const referenceImages = [];
  if (req.files?.length) {
    if (!body.photoConsent) {
      throw ApiError.badRequest(
        'Tick the consent box before uploading a personal photo, so we may store it for this commission.',
      );
    }
    const stored = await Promise.all(
      req.files.map((file) => storeImage(file, { folder: `commissions/${req.user?._id ?? 'guest'}` })),
    );
    stored.forEach((image) => referenceImages.push({ url: image.url, publicId: image.publicId }));
  }

  const request = await CommissionRequest.create({
    reference: generateCommissionReference(),
    kind: body.kind,
    customer: req.user?._id ?? null,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone ?? '',
    artist: artistProfile?._id ?? null,
    artistUser: artistProfile?.user ?? null,
    artwork: artwork?._id ?? null,
    subject: body.subject ?? '',
    message: body.message,
    styleKey: body.styleKey ?? '',
    referenceImages,
    photoConsent: Boolean(body.photoConsent),
    preferredSize: body.preferredSize ?? '',
    budgetMinor: body.budget == null ? null : toMinor(body.budget),
    deadline: body.deadline ?? null,
    status: 'new',
  });

  if (artistProfile?.user) {
    await notify(artistProfile.user, {
      type: 'commission_received',
      title: `New ${body.kind === 'enquiry' ? 'enquiry' : 'commission request'} (${request.reference})`,
      body: body.subject || body.message.slice(0, 140),
      link: '/artist/enquiries',
    });
  }

  res.status(201).json({
    request: commissionShape(request),
    // Honest about delivery: no email is sent unless SMTP is configured.
    emailSent: false,
    notice: env.mail.smtpUrl
      ? 'We have passed your request to the studio.'
      : 'Your request is saved and visible to the studio in their dashboard. Email notifications are not configured on this server.',
  });
});

export const listMyCommissionRequests = asyncHandler(async (req, res) => {
  const requests = await CommissionRequest.find({ customer: req.user._id })
    .populate('artist', 'displayName slug')
    .populate('artwork', 'title slug')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ items: requests.map(commissionShape) });
});

/** GET /api/artist/enquiries — scoped to the signed-in artist. */
export const listArtistEnquiries = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const filter = { artistUser: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [requests, total] = await Promise.all([
    CommissionRequest.find(filter)
      .populate('artwork', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CommissionRequest.countDocuments(filter),
  ]);

  res.json({ items: requests.map(commissionShape), meta: buildPageMeta({ page, limit, total }) });
});

/** PATCH /api/artist/enquiries/:id — artist replies, quotes or declines. */
export const respondToEnquiry = asyncHandler(async (req, res) => {
  const { status, quotedAmount, quoteNote, reply } = req.body;

  const request = await CommissionRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('That enquiry was not found.');

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && String(request.artistUser) !== String(req.user._id)) {
    throw ApiError.forbidden('That enquiry was not sent to you.');
  }

  if (status) request.status = status;
  if (quotedAmount !== undefined) {
    request.quotedAmountMinor = quotedAmount == null ? null : toMinor(quotedAmount);
  }
  if (quoteNote !== undefined) request.quoteNote = quoteNote;

  if (reply?.trim()) {
    request.messages.push({
      from: req.user._id,
      fromRole: req.user.role,
      body: reply.trim(),
      at: new Date(),
    });
  }

  await request.save();

  if (request.customer) {
    await notify(request.customer, {
      type: 'commission_update',
      title: `Update on your request ${request.reference}`,
      body: reply?.slice(0, 140) || `The studio marked your request as ${request.status.replace('_', ' ')}.`,
      link: '/account/commissions',
    });
  }

  res.json({ request: commissionShape(request) });
});

/* ──────────────────────────── Notifications ──────────────────────────── */

export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 20 });

  const [items, total, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments({ user: req.user._id }),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);

  res.json({
    items: items.map((item) => ({
      id: String(item._id),
      type: item.type,
      title: item.title,
      body: item.body,
      link: item.link,
      readAt: item.readAt,
      createdAt: item.createdAt,
    })),
    unread,
    meta: buildPageMeta({ page, limit, total }),
  });
});

export const markNotificationsRead = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id, readAt: null };
  if (req.body.ids?.length) filter._id = { $in: req.body.ids };

  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  const unread = await Notification.countDocuments({ user: req.user._id, readAt: null });

  res.json({ updated: result.modifiedCount, unread });
});

/* ────────────────────────────── Uploads ────────────────────────────── */

/**
 * POST /api/uploads/images
 *
 * A staging endpoint for the artwork form: images are validated and stored,
 * then referenced by URL when the listing is saved. Artist-only, because
 * storage costs money.
 */
export const uploadImages = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('Choose at least one image to upload.');

  const stored = await Promise.all(
    req.files.map((file) => storeImage(file, { folder: `staging/${req.user._id}` })),
  );

  res.status(201).json({ images: stored });
});

/* ──────────────────────── Photo-to-Art studio ──────────────────────── */

export const STUDIO_STYLES = [
  {
    key: 'dreamscape',
    name: 'Dreamscape',
    description: 'Soft bloom, lifted shadows and a cool violet wash, as if remembered rather than seen.',
    // Applied in the browser on a canvas copy. Nothing is uploaded for this.
    cssFilter: 'saturate(1.25) contrast(0.92) brightness(1.08) hue-rotate(-12deg) blur(0.4px)',
    overlay: 'linear-gradient(135deg, rgba(120,90,220,0.22), rgba(255,170,200,0.14))',
  },
  {
    key: 'ink_wash',
    name: 'Ink & Wash',
    description: 'Monochrome brush study with deep blacks and paper-grain highlights.',
    cssFilter: 'grayscale(1) contrast(1.45) brightness(1.04)',
    overlay: 'linear-gradient(180deg, rgba(20,20,20,0.1), rgba(250,248,240,0.18))',
  },
  {
    key: 'pop_art',
    name: 'Pop Art',
    description: 'Flattened tone, hard edges and a saturated screen-print palette.',
    cssFilter: 'saturate(2.3) contrast(1.5) brightness(1.06) hue-rotate(8deg)',
    overlay: 'linear-gradient(45deg, rgba(196,106,74,0.20), rgba(217,133,101,0.16))',
  },
  {
    key: 'golden_hour',
    name: 'Golden Hour',
    description: 'Warm low sun, amber falloff and a gentle film curve.',
    cssFilter: 'sepia(0.35) saturate(1.5) contrast(1.08) brightness(1.06)',
    overlay: 'linear-gradient(160deg, rgba(255,186,73,0.22), rgba(190,80,30,0.12))',
  },
];

/**
 * GET /api/studio/config
 *
 * States plainly what the studio can and cannot do on this server. When no AI
 * provider is configured the styles are browser-side previews, and the client
 * says so instead of implying a generated artwork.
 */
export const getStudioConfig = asyncHandler(async (_req, res) => {
  const aiEnabled = Boolean(env.ai.provider && env.ai.apiKey);

  res.json({
    styles: STUDIO_STYLES,
    aiGeneration: {
      enabled: aiEnabled,
      provider: aiEnabled ? env.ai.provider : null,
      notice: aiEnabled
        ? 'Your photo will be sent to the configured image service only after you give consent.'
        : 'Style previews are rendered in your browser only. Your photo stays on your device unless you choose to send it with a commission request.',
    },
    maxUploadMb: env.storage.maxUploadMb,
  });
});
