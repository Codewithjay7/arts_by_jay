import { Category, ArtistProfile } from '../models/index.js';
import { toMinor } from '../utils/money.js';

/**
 * Translates storefront filter params into a Mongo filter plus sort.
 *
 * Always scoped to `status: published` for public browsing, so a draft,
 * rejected or unpublished listing can never leak into the shop, the search
 * results or the virtual gallery.
 */
export const buildArtworkQuery = async (params) => {
  const filter = { status: 'published' };
  const meta = { resolvedCategory: null, resolvedArtist: null };

  if (params.q) {
    // $text uses the weighted index; it beats a regex scan on large catalogues.
    filter.$text = { $search: params.q };
  }

  if (params.category) {
    const category = await Category.findOne({
      $or: [{ slug: params.category }, ...(params.category.match(/^[a-f\d]{24}$/i) ? [{ _id: params.category }] : [])],
    }).lean();

    if (!category) return { filter: null, sort: null, meta };

    // Include direct children so a parent category shows everything beneath it.
    const children = await Category.find({ parent: category._id }).select('_id').lean();
    const ids = [category._id, ...children.map((child) => child._id)];
    filter.category = { $in: ids };
    meta.resolvedCategory = category;
  }

  if (params.artist) {
    const artist = await ArtistProfile.findOne({
      $or: [{ slug: params.artist }, ...(params.artist.match(/^[a-f\d]{24}$/i) ? [{ _id: params.artist }] : [])],
    }).lean();

    if (!artist) return { filter: null, sort: null, meta };
    filter.artist = artist._id;
    meta.resolvedArtist = artist;
  }

  if (params.type) filter.type = params.type;
  if (params.orientation) filter.orientation = params.orientation;
  if (params.medium) filter.medium = new RegExp(escapeRegex(params.medium), 'i');
  if (params.style) filter.style = new RegExp(escapeRegex(params.style), 'i');
  if (params.tags?.length) filter.tags = { $in: params.tags };
  if (params.featured !== undefined) filter.isFeatured = params.featured;

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    filter.priceMinor = {};
    if (params.minPrice !== undefined) filter.priceMinor.$gte = toMinor(params.minPrice);
    if (params.maxPrice !== undefined) filter.priceMinor.$lte = toMinor(params.maxPrice);
  }

  if (params.availability === 'available') {
    filter.$or = [{ stock: { $gt: 0 } }, { allowBackorder: true }, { 'shipping.isDigitalDelivery': true }];
  } else if (params.availability === 'sold') {
    filter.stock = { $lte: 0 };
    filter.allowBackorder = false;
    filter['shipping.isDigitalDelivery'] = false;
  }

  const sort = buildSort(params.sort, Boolean(params.q));
  return { filter, sort, meta };
};

const buildSort = (key, hasSearch) => {
  switch (key) {
    case 'price_asc':
      return { priceMinor: 1, _id: 1 };
    case 'price_desc':
      return { priceMinor: -1, _id: 1 };
    case 'oldest':
      return { publishedAt: 1, _id: 1 };
    case 'popular':
      return { 'stats.unitsSold': -1, 'stats.views': -1, _id: 1 };
    case 'relevance':
      return hasSearch ? { score: { $meta: 'textScore' }, publishedAt: -1 } : { publishedAt: -1, _id: 1 };
    case 'newest':
    default:
      // With a search term, relevance is the more useful default ordering.
      return hasSearch ? { score: { $meta: 'textScore' }, publishedAt: -1 } : { publishedAt: -1, _id: 1 };
  }
};

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export const ARTWORK_CARD_FIELDS =
  'title slug priceMinor compareAtPriceMinor currency images type medium style stock allowBackorder status orientation dimensions shipping stats artist category publishedAt isFeatured inVirtualGallery';

/** The shape every artwork card in the client expects. */
export const toCard = (doc) => {
  const artwork = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc;
  const image = artwork.images?.[0] ?? null;
  const digital = Boolean(artwork.shipping?.isDigitalDelivery);
  const soldOut = !digital && !artwork.allowBackorder && (artwork.stock ?? 0) <= 0;

  return {
    id: String(artwork._id),
    title: artwork.title,
    slug: artwork.slug,
    priceMinor: artwork.priceMinor,
    compareAtPriceMinor: artwork.compareAtPriceMinor ?? null,
    currency: artwork.currency,
    image: image ? { url: image.url, thumbUrl: image.thumbUrl || image.url, alt: image.alt || artwork.title } : null,
    type: artwork.type,
    medium: artwork.medium,
    style: artwork.style,
    orientation: artwork.orientation,
    dimensions: artwork.dimensions ?? null,
    stock: artwork.stock,
    isSoldOut: soldOut,
    isPurchasable: artwork.status === 'published' && artwork.type !== 'commission' && !soldOut,
    isFeatured: Boolean(artwork.isFeatured),
    rating: { average: artwork.stats?.ratingAverage ?? 0, count: artwork.stats?.ratingCount ?? 0 },
    artist: artwork.artist?.displayName
      ? { id: String(artwork.artist._id), displayName: artwork.artist.displayName, slug: artwork.artist.slug }
      : artwork.artist
        ? { id: String(artwork.artist) }
        : null,
    category: artwork.category?.name
      ? { id: String(artwork.category._id), name: artwork.category.name, slug: artwork.category.slug }
      : null,
    publishedAt: artwork.publishedAt,
  };
};
