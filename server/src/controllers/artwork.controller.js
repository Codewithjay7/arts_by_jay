import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { Artwork, Review, Wishlist } from '../models/index.js';
import { buildArtworkQuery, ARTWORK_CARD_FIELDS, toCard } from '../services/artworkQuery.js';
import { buildPageMeta } from '../utils/pagination.js';

/** GET /api/artworks — the storefront grid, search and filters. */
export const browseArtworks = asyncHandler(async (req, res) => {
  const params = req.query;
  const { filter, sort, meta } = await buildArtworkQuery(params);

  // A filter that resolved to a non-existent category or artist yields an
  // honest empty result rather than an unfiltered catalogue.
  if (!filter) {
    res.json({
      items: [],
      meta: buildPageMeta({ page: params.page, limit: params.limit, total: 0 }),
      filters: { category: null, artist: null },
    });
    return;
  }

  const skip = (params.page - 1) * params.limit;
  const projection = params.q ? { score: { $meta: 'textScore' } } : {};

  const [docs, total] = await Promise.all([
    Artwork.find(filter, projection)
      .select(ARTWORK_CARD_FIELDS)
      .populate('artist', 'displayName slug')
      .populate('category', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(params.limit)
      .lean(),
    Artwork.countDocuments(filter),
  ]);

  res.json({
    items: docs.map(toCard),
    meta: buildPageMeta({ page: params.page, limit: params.limit, total }),
    filters: {
      category: meta.resolvedCategory
        ? { id: String(meta.resolvedCategory._id), name: meta.resolvedCategory.name, slug: meta.resolvedCategory.slug }
        : null,
      artist: meta.resolvedArtist
        ? { id: String(meta.resolvedArtist._id), displayName: meta.resolvedArtist.displayName, slug: meta.resolvedArtist.slug }
        : null,
    },
  });
});

/** Distinct values actually present in the published catalogue, for filter UI. */
export const getFilterFacets = asyncHandler(async (_req, res) => {
  const [mediums, styles, tags, priceRange] = await Promise.all([
    Artwork.distinct('medium', { status: 'published', medium: { $ne: '' } }),
    Artwork.distinct('style', { status: 'published', style: { $ne: '' } }),
    Artwork.distinct('tags', { status: 'published' }),
    Artwork.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: null, min: { $min: '$priceMinor' }, max: { $max: '$priceMinor' } } },
    ]),
  ]);

  res.json({
    mediums: mediums.sort(),
    styles: styles.sort(),
    tags: tags.filter(Boolean).sort().slice(0, 60),
    price: { minMinor: priceRange[0]?.min ?? 0, maxMinor: priceRange[0]?.max ?? 0 },
  });
});

/** Curated collections for the home page, in one round trip. */
export const getHomeCollections = asyncHandler(async (_req, res) => {
  const base = { status: 'published' };

  const pick = (filter, sort, limit) =>
    Artwork.find({ ...base, ...filter })
      .select(ARTWORK_CARD_FIELDS)
      .populate('artist', 'displayName slug')
      .populate('category', 'name slug')
      .sort(sort)
      .limit(limit)
      .lean();

  const [featured, newArrivals, trending, originals, prints] = await Promise.all([
    pick({ isFeatured: true }, { publishedAt: -1 }, 6),
    pick({}, { publishedAt: -1 }, 8),
    pick({}, { 'stats.unitsSold': -1, 'stats.views': -1 }, 8),
    pick({ type: 'original' }, { publishedAt: -1 }, 8),
    pick({ type: 'print' }, { publishedAt: -1 }, 8),
  ]);

  res.json({
    featured: featured.map(toCard),
    newArrivals: newArrivals.map(toCard),
    trending: trending.map(toCard),
    originals: originals.map(toCard),
    prints: prints.map(toCard),
  });
});

const findPublishedArtwork = async (idOrSlug) => {
  const byId = /^[a-f\d]{24}$/i.test(idOrSlug);
  return Artwork.findOne({
    status: 'published',
    $or: [{ slug: idOrSlug }, ...(byId ? [{ _id: idOrSlug }] : [])],
  })
    .populate('artist', 'displayName slug bio avatarUrl location acceptsCommissions commissionNote status stats')
    .populate('category', 'name slug');
};

/** GET /api/artworks/:idOrSlug — full detail page payload. */
export const getArtworkDetail = asyncHandler(async (req, res) => {
  const artwork = await findPublishedArtwork(req.params.idOrSlug);
  if (!artwork) throw ApiError.notFound('That artwork is not available.');

  // Fire-and-forget view counter; must not slow or fail the page.
  Artwork.updateOne({ _id: artwork._id }, { $inc: { 'stats.views': 1 } }).catch(() => {});

  const [related, reviews, isWishlisted] = await Promise.all([
    Artwork.find({
      status: 'published',
      _id: { $ne: artwork._id },
      $or: [{ category: artwork.category?._id }, { artist: artwork.artist?._id }],
    })
      .select(ARTWORK_CARD_FIELDS)
      .populate('artist', 'displayName slug')
      .populate('category', 'name slug')
      .sort({ publishedAt: -1 })
      .limit(8)
      .lean(),
    Review.find({ artwork: artwork._id, isHidden: false })
      .populate('author', 'name avatarUrl')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    req.user
      ? Wishlist.exists({ user: req.user._id, artworks: artwork._id }).then(Boolean)
      : Promise.resolve(false),
  ]);

  const object = artwork.toObject({ virtuals: true });

  res.json({
    artwork: {
      ...toCard(object),
      description: object.description,
      story: object.story,
      year: object.year,
      tags: object.tags,
      isFramed: object.isFramed,
      weightGrams: object.weightGrams,
      allowBackorder: object.allowBackorder,
      images: (object.images ?? []).map((image) => ({
        url: image.url,
        thumbUrl: image.thumbUrl || image.url,
        alt: image.alt || object.title,
        width: image.width,
        height: image.height,
      })),
      shipping: {
        shipsFrom: object.shipping?.shipsFrom ?? '',
        processingDays: object.shipping?.processingDays ?? 3,
        flatRateMinor: object.shipping?.flatRateMinor ?? 0,
        isDigitalDelivery: Boolean(object.shipping?.isDigitalDelivery),
      },
      artist: object.artist
        ? {
            id: String(object.artist._id),
            displayName: object.artist.displayName,
            slug: object.artist.slug,
            bio: object.artist.bio,
            avatarUrl: object.artist.avatarUrl,
            location: object.artist.location,
            acceptsCommissions: object.artist.acceptsCommissions,
            commissionNote: object.artist.commissionNote,
            publishedArtworks: object.artist.stats?.publishedArtworks ?? 0,
          }
        : null,
      viewerState: { isWishlisted },
    },
    related: related.map(toCard),
    reviews: reviews.map((review) => ({
      id: String(review._id),
      rating: review.rating,
      title: review.title,
      body: review.body,
      isVerifiedPurchase: review.isVerifiedPurchase,
      createdAt: review.createdAt,
      author: { name: review.author?.name ?? 'Collector', avatarUrl: review.author?.avatarUrl ?? '' },
    })),
  });
});
