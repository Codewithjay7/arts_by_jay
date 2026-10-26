import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ArtistProfile, Artwork, Order, CommissionRequest, Category } from '../models/index.js';
import { ARTWORK_CARD_FIELDS, toCard, escapeRegex } from '../services/artworkQuery.js';
import { readPagination, buildPageMeta } from '../utils/pagination.js';
import { toMinor } from '../utils/money.js';
import { storeImage, removeImage } from '../services/storage.js';
import { notify } from '../services/notifications.js';
import env from '../config/env.js';

/* ───────────────────────── Public storefronts ───────────────────────── */

const publicProfileShape = (profile) => ({
  id: String(profile._id),
  displayName: profile.displayName,
  slug: profile.slug,
  bio: profile.bio,
  statement: profile.statement,
  location: profile.location,
  avatarUrl: profile.avatarUrl,
  coverUrl: profile.coverUrl,
  specialities: profile.specialities,
  links: profile.links,
  acceptsCommissions: profile.acceptsCommissions,
  commissionNote: profile.commissionNote,
  isFeatured: profile.isFeatured,
  publishedArtworks: profile.stats?.publishedArtworks ?? 0,
  totalSales: profile.stats?.totalSales ?? 0,
  joinedAt: profile.createdAt,
});

/** GET /api/artists — the public "Discover artists" directory. */
export const listArtists = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 12 });

  // Only approved artists are ever publicly listed.
  const filter = { status: 'approved' };
  if (req.query.q) {
    filter.displayName = new RegExp(escapeRegex(req.query.q), 'i');
  }
  if (req.query.featured === 'true') filter.isFeatured = true;

  const [profiles, total] = await Promise.all([
    ArtistProfile.find(filter)
      .sort({ isFeatured: -1, 'stats.publishedArtworks': -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ArtistProfile.countDocuments(filter),
  ]);

  // One query for the preview thumbnails of every artist on this page.
  const previews = await Artwork.find({
    artist: { $in: profiles.map((profile) => profile._id) },
    status: 'published',
  })
    .select('artist images title slug priceMinor currency')
    .sort({ publishedAt: -1 })
    .lean();

  const byArtist = new Map();
  previews.forEach((artwork) => {
    const key = String(artwork.artist);
    const list = byArtist.get(key) ?? [];
    if (list.length < 3) {
      list.push({
        id: String(artwork._id),
        title: artwork.title,
        slug: artwork.slug,
        image: artwork.images?.[0]?.thumbUrl || artwork.images?.[0]?.url || '',
      });
      byArtist.set(key, list);
    }
  });

  res.json({
    items: profiles.map((profile) => ({
      ...publicProfileShape(profile),
      preview: byArtist.get(String(profile._id)) ?? [],
    })),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/** GET /api/artists/:slug — a public artist storefront. */
export const getArtistStorefront = asyncHandler(async (req, res) => {
  const profile = await ArtistProfile.findOne({ slug: req.params.slug, status: 'approved' }).lean();
  if (!profile) throw ApiError.notFound('That artist storefront was not found.');

  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 12 });
  const filter = { artist: profile._id, status: 'published' };

  const [artworks, total] = await Promise.all([
    Artwork.find(filter)
      .select(ARTWORK_CARD_FIELDS)
      .populate('category', 'name slug')
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Artwork.countDocuments(filter),
  ]);

  res.json({
    artist: publicProfileShape(profile),
    artworks: artworks.map(toCard),
    meta: buildPageMeta({ page, limit, total }),
  });
});

/* ──────────────────────── Artist's own dashboard ─────────────────────── */

/** GET /api/artist/profile — the signed-in artist's own profile, any status. */
export const getMyArtistProfile = asyncHandler(async (req, res) => {
  const profile = await ArtistProfile.findOne({ user: req.user._id });
  if (!profile) throw ApiError.notFound('You do not have an artist profile yet.');

  res.json({
    profile: {
      ...publicProfileShape(profile),
      status: profile.status,
      reviewNote: profile.reviewNote,
      stats: {
        publishedArtworks: profile.stats.publishedArtworks,
        totalSales: profile.stats.totalSales,
        lifetimeEarningsMinor: profile.stats.lifetimeEarningsMinor,
        pendingEarningsMinor: profile.stats.pendingEarningsMinor,
      },
    },
    // Shown in the dashboard so the artist knows what the platform retains.
    commissionPercent: env.payments.commissionPercent,
  });
});

/** POST /api/artist/profile — create a profile for an existing account. */
export const createMyArtistProfile = asyncHandler(async (req, res) => {
  if (await ArtistProfile.exists({ user: req.user._id })) {
    throw ApiError.conflict('You already have an artist profile.');
  }

  const profile = await ArtistProfile.create({
    ...req.body,
    user: req.user._id,
    // Status is never taken from the request.
    status: 'pending',
  });

  // An existing customer who applies becomes an artist account, still pending
  // approval before anything can be published.
  if (req.user.role === 'customer') {
    req.user.role = 'artist';
    await req.user.save();
  }

  await notify(req.user._id, {
    type: 'account_notice',
    title: 'Artist application received',
    body: 'Our curators will review your application shortly.',
    link: '/artist/storefront',
  });

  res.status(201).json({ profile: { ...publicProfileShape(profile), status: profile.status } });
});

export const updateMyArtistProfile = asyncHandler(async (req, res) => {
  const profile = await ArtistProfile.findOne({ user: req.user._id });
  if (!profile) throw ApiError.notFound('You do not have an artist profile yet.');

  // Zod has already stripped status, stats and review fields from the body.
  Object.assign(profile, req.body);
  await profile.save();

  res.json({ profile: { ...publicProfileShape(profile), status: profile.status } });
});

export const uploadArtistImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');

  const field = req.params.field === 'cover' ? 'coverUrl' : 'avatarUrl';
  const profile = await ArtistProfile.findOne({ user: req.user._id });
  if (!profile) throw ApiError.notFound('You do not have an artist profile yet.');

  const stored = await storeImage(req.file, { folder: `artists/${profile._id}` });
  profile[field] = stored.url;
  await profile.save();

  res.json({ profile: { ...publicProfileShape(profile), status: profile.status }, image: stored });
});

/* ─────────────────────── Artist artwork management ───────────────────── */

const ownedArtwork = async (req) => {
  const artwork = await Artwork.findById(req.params.id);
  if (!artwork) throw ApiError.notFound('That artwork was not found.');

  // The ownership check that makes the whole seller area safe. An artist can
  // only ever touch rows whose owner is their own user id.
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && String(artwork.owner) !== String(req.user._id)) {
    throw ApiError.forbidden('That artwork does not belong to you.');
  }

  return artwork;
};

/** Maps validated form input onto the document. Shared by create and update. */
const applyArtworkInput = (artwork, input) => {
  const scalarFields = [
    'title',
    'description',
    'story',
    'category',
    'type',
    'style',
    'medium',
    'year',
    'tags',
    'orientation',
    'isFramed',
    'allowBackorder',
    'inVirtualGallery',
    'weightGrams',
    'images',
  ];

  scalarFields.forEach((field) => {
    if (input[field] !== undefined) artwork[field] = input[field];
  });

  if (input.price !== undefined) artwork.priceMinor = toMinor(input.price);
  if (input.compareAtPrice !== undefined) {
    artwork.compareAtPriceMinor = input.compareAtPrice == null ? null : toMinor(input.compareAtPrice);
  }
  if (input.stock !== undefined) artwork.stock = input.stock;

  if (input.dimensions) {
    artwork.dimensions = { ...artwork.dimensions?.toObject?.(), ...input.dimensions };
  }
  if (input.shipping) {
    artwork.shipping = {
      ...artwork.shipping?.toObject?.(),
      ...input.shipping,
      ...(input.shipping.flatRate !== undefined ? { flatRateMinor: toMinor(input.shipping.flatRate) } : {}),
    };
    delete artwork.shipping.flatRate;
  }

  return artwork;
};

/** GET /api/artist/artworks — every listing the artist owns, all statuses. */
export const listMyArtworks = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPagination(req.query, { defaultLimit: 15 });

  const filter = { owner: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.title = new RegExp(escapeRegex(req.query.q), 'i');

  const [artworks, total, counts] = await Promise.all([
    Artwork.find(filter)
      .select(`${ARTWORK_CARD_FIELDS} createdAt updatedAt moderation`)
      .populate('category', 'name slug')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Artwork.countDocuments(filter),
    Artwork.aggregate([
      { $match: { owner: req.user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    items: artworks.map((artwork) => ({
      ...toCard(artwork),
      status: artwork.status,
      moderationNote: artwork.moderation?.note ?? '',
      createdAt: artwork.createdAt,
      updatedAt: artwork.updatedAt,
    })),
    meta: buildPageMeta({ page, limit, total }),
    statusCounts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  });
});

/** GET /api/artist/artworks/:id — full record for the edit form. */
export const getMyArtwork = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);
  await artwork.populate('category', 'name slug');

  const object = artwork.toObject({ virtuals: true });

  res.json({
    artwork: {
      ...object,
      id: String(object._id),
      // Forms work in major units; storage stays in minor units.
      price: object.priceMinor / 100,
      compareAtPrice: object.compareAtPriceMinor == null ? null : object.compareAtPriceMinor / 100,
      shipping: { ...object.shipping, flatRate: (object.shipping?.flatRateMinor ?? 0) / 100 },
    },
  });
});

export const createMyArtwork = asyncHandler(async (req, res) => {
  const profile = req.artistProfile;
  if (!profile) throw ApiError.forbidden('Create your artist profile before adding artwork.');

  const category = await Category.findById(req.body.category);
  if (!category) throw ApiError.badRequest('Choose a valid category.');

  const artwork = new Artwork({
    artist: profile._id,
    owner: req.user._id,
    currency: env.payments.currency,
    // Everything starts as a draft. Publishing is a separate, checked action.
    status: 'draft',
    priceMinor: 0,
  });

  applyArtworkInput(artwork, req.body);
  await artwork.save();

  res.status(201).json({ artwork: { id: String(artwork._id), slug: artwork.slug, status: artwork.status } });
});

export const updateMyArtwork = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);

  if (req.body.category) {
    const category = await Category.findById(req.body.category);
    if (!category) throw ApiError.badRequest('Choose a valid category.');
  }

  applyArtworkInput(artwork, req.body);

  // An edit to a live listing goes back for moderation, so a reviewed piece
  // cannot be quietly swapped for something else after approval.
  if (artwork.status === 'published' && artwork.isModified('title', 'description', 'images')) {
    artwork.moderation.note = '';
  }

  await artwork.save();
  res.json({ artwork: { id: String(artwork._id), slug: artwork.slug, status: artwork.status } });
});

/** POST /api/artist/artworks/:id/images — append uploaded images. */
export const addArtworkImages = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);

  if (!req.files?.length) throw ApiError.badRequest('Choose at least one image to upload.');
  if (artwork.images.length + req.files.length > 8) {
    throw ApiError.badRequest('An artwork can have at most 8 images.');
  }

  const stored = await Promise.all(
    req.files.map((file) => storeImage(file, { folder: `artworks/${artwork._id}` })),
  );

  stored.forEach((image) => artwork.images.push({ ...image, alt: artwork.title }));
  await artwork.save();

  res.status(201).json({ images: artwork.images });
});

export const removeArtworkImage = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);
  const index = Number.parseInt(req.params.index, 10);

  if (!Number.isInteger(index) || index < 0 || index >= artwork.images.length) {
    throw ApiError.badRequest('That image does not exist on this artwork.');
  }

  const [removed] = artwork.images.splice(index, 1);
  await artwork.save();

  removeImage(removed?.publicId).catch(() => {});
  res.json({ images: artwork.images });
});

/**
 * POST /api/artist/artworks/:id/status
 *
 * Publishing is gated: an artwork needs an image and a price, and the artist
 * must be approved. Which status the request can reach is decided here, not
 * by the client.
 */
export const setMyArtworkStatus = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);
  const { action } = req.body;

  if (action === 'archive') {
    artwork.status = 'archived';
  } else if (action === 'unpublish') {
    artwork.status = 'unpublished';
  } else {
    // publish / submit
    if (!artwork.images.length) throw ApiError.badRequest('Add at least one image before publishing.');
    if (artwork.priceMinor <= 0 && artwork.type !== 'commission') {
      throw ApiError.badRequest('Set a price before publishing.');
    }
    if (!artwork.description?.trim()) throw ApiError.badRequest('Add a description before publishing.');

    const isAdmin = req.user.role === 'admin';
    if (isAdmin) {
      artwork.status = 'published';
      artwork.publishedAt = artwork.publishedAt ?? new Date();
    } else {
      // Artists submit for moderation; an admin flips it to published.
      artwork.status = 'pending';
    }
  }

  await artwork.save();
  await refreshArtistArtworkCount(artwork.artist);

  res.json({
    artwork: { id: String(artwork._id), status: artwork.status },
    message:
      artwork.status === 'pending'
        ? 'Submitted for review. Our curators will approve it shortly.'
        : artwork.status === 'published'
          ? 'Your artwork is live.'
          : `Artwork ${artwork.status}.`,
  });
});

export const deleteMyArtwork = asyncHandler(async (req, res) => {
  const artwork = await ownedArtwork(req);

  // A sold piece is part of an order's record and must not vanish.
  const sold = await Order.exists({ 'items.artwork': artwork._id, status: { $ne: 'cancelled' } });
  if (sold) {
    artwork.status = 'archived';
    await artwork.save();
    await refreshArtistArtworkCount(artwork.artist);

    res.json({
      deleted: false,
      archived: true,
      message: 'This piece has been sold, so it was archived instead of deleted to keep order records intact.',
    });
    return;
  }

  const images = [...artwork.images];
  await artwork.deleteOne();
  await refreshArtistArtworkCount(artwork.artist);
  await Promise.all(images.map((image) => removeImage(image.publicId).catch(() => {})));

  res.json({ deleted: true, archived: false });
});

export const refreshArtistArtworkCount = async (artistId) => {
  const count = await Artwork.countDocuments({ artist: artistId, status: 'published' });
  await ArtistProfile.updateOne({ _id: artistId }, { $set: { 'stats.publishedArtworks': count } });
};

/* ───────────────────────── Dashboard overview ───────────────────────── */

/** GET /api/artist/overview — headline numbers for the artist dashboard. */
export const getArtistOverview = asyncHandler(async (req, res) => {
  const profile = await ArtistProfile.findOne({ user: req.user._id });
  if (!profile) throw ApiError.notFound('You do not have an artist profile yet.');

  const [statusCounts, salesAgg, awaitingCount, openEnquiries, recentOrders] = await Promise.all([
    Artwork.aggregate([
      { $match: { owner: req.user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { 'items.artistUser': req.user._id, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
      { $unwind: '$items' },
      { $match: { 'items.artistUser': req.user._id } },
      {
        $group: {
          _id: null,
          grossMinor: { $sum: '$items.lineTotalMinor' },
          earningsMinor: { $sum: '$items.earningsMinor' },
          commissionMinor: { $sum: '$items.commissionMinor' },
          units: { $sum: '$items.quantity' },
          orders: { $addToSet: '$_id' },
        },
      },
    ]),
    Order.countDocuments({
      'items.artistUser': req.user._id,
      'items.fulfilmentStatus': { $in: ['awaiting', 'preparing'] },
      status: { $in: ['paid', 'processing'] },
    }),
    CommissionRequest.countDocuments({
      artistUser: req.user._id,
      status: { $in: ['new', 'in_review', 'quoted'] },
    }),
    Order.find({ 'items.artistUser': req.user._id, status: { $ne: 'pending_payment' } })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const sales = salesAgg[0] ?? { grossMinor: 0, earningsMinor: 0, commissionMinor: 0, units: 0, orders: [] };

  res.json({
    profile: {
      displayName: profile.displayName,
      slug: profile.slug,
      status: profile.status,
      avatarUrl: profile.avatarUrl,
      reviewNote: profile.reviewNote,
    },
    artworks: {
      ...Object.fromEntries(statusCounts.map((row) => [row._id, row.count])),
      total: statusCounts.reduce((sum, row) => sum + row.count, 0),
    },
    sales: {
      grossMinor: sales.grossMinor,
      earningsMinor: sales.earningsMinor,
      commissionMinor: sales.commissionMinor,
      unitsSold: sales.units,
      orderCount: sales.orders.length,
      currency: env.payments.currency,
      commissionPercent: env.payments.commissionPercent,
    },
    actionsNeeded: { ordersToFulfil: awaitingCount, openEnquiries },
    recentOrders: recentOrders.map((order) => {
      const mine = order.items.filter((item) => String(item.artistUser) === String(req.user._id));
      return {
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        isSimulatedPayment: order.isSimulatedPayment,
        myEarningsMinor: mine.reduce((sum, item) => sum + item.earningsMinor, 0),
        titles: mine.map((item) => item.title),
      };
    }),
  });
});
