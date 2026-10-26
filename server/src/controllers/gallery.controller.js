import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { Artwork } from '../models/index.js';
import { ARTWORK_CARD_FIELDS, toCard } from '../services/artworkQuery.js';
import { layoutArtworks, describeRooms, corridorLength, SLOTS_PER_ROOM } from '../services/galleryLayout.js';

/**
 * GET /api/gallery
 *
 * The immersive gallery hangs REAL marketplace listings. There is no separate
 * gallery catalogue: every wall position resolves to a published Artwork, and
 * the payload carries live price and availability so a sold piece shows its
 * true status rather than a stale one.
 */
export const getGallery = asyncHandler(async (req, res) => {
  const limit = Math.min(48, Math.max(SLOTS_PER_ROOM, Number.parseInt(req.query.limit, 10) || 24));

  const filter = { status: 'published', inVirtualGallery: true, 'images.0': { $exists: true } };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.artist) filter.artist = req.query.artist;

  const docs = await Artwork.find(filter)
    .select(ARTWORK_CARD_FIELDS)
    .populate('artist', 'displayName slug')
    .populate('category', 'name slug')
    // Featured work first, then newest, so the opening room is the strongest.
    .sort({ isFeatured: -1, publishedAt: -1 })
    .limit(limit)
    .lean();

  const cards = docs.map(toCard);
  const laidOut = layoutArtworks(cards);

  res.json({
    artworks: laidOut,
    rooms: describeRooms(laidOut),
    layout: {
      slotsPerRoom: SLOTS_PER_ROOM,
      corridorLength: corridorLength(laidOut),
      totalRooms: Math.max(1, Math.ceil(laidOut.length / SLOTS_PER_ROOM)),
    },
    total: laidOut.length,
  });
});

/**
 * GET /api/gallery/artworks/:id
 *
 * The cinematic detail view. Returns the same product record the shop uses,
 * so adding to the cart from inside the gallery and from the shop are the
 * same operation on the same listing.
 */
export const getGalleryArtwork = asyncHandler(async (req, res) => {
  const artwork = await Artwork.findOne({ _id: req.params.id, status: 'published' })
    .populate('artist', 'displayName slug bio avatarUrl acceptsCommissions commissionNote')
    .populate('category', 'name slug')
    .lean();

  if (!artwork) {
    // A piece can sell or be unpublished while a visitor is mid-corridor.
    const alternatives = await Artwork.find({ status: 'published', inVirtualGallery: true })
      .select(ARTWORK_CARD_FIELDS)
      .populate('artist', 'displayName slug')
      .sort({ publishedAt: -1 })
      .limit(4)
      .lean();

    throw ApiError.notFound('That piece is no longer on display.', {
      code: 'ARTWORK_GONE',
      details: { alternatives: alternatives.map(toCard) },
    });
  }

  res.json({
    artwork: {
      ...toCard(artwork),
      description: artwork.description,
      story: artwork.story,
      year: artwork.year,
      tags: artwork.tags,
      isFramed: artwork.isFramed,
      images: (artwork.images ?? []).map((image) => ({
        url: image.url,
        thumbUrl: image.thumbUrl || image.url,
        alt: image.alt || artwork.title,
      })),
      shipping: {
        shipsFrom: artwork.shipping?.shipsFrom ?? '',
        processingDays: artwork.shipping?.processingDays ?? 3,
        isDigitalDelivery: Boolean(artwork.shipping?.isDigitalDelivery),
      },
      artist: artwork.artist
        ? {
            id: String(artwork.artist._id),
            displayName: artwork.artist.displayName,
            slug: artwork.artist.slug,
            bio: artwork.artist.bio,
            avatarUrl: artwork.artist.avatarUrl,
            acceptsCommissions: artwork.artist.acceptsCommissions,
            commissionNote: artwork.artist.commissionNote,
          }
        : null,
    },
  });
});
