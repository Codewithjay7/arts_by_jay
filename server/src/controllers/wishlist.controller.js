import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { Wishlist, Artwork } from '../models/index.js';
import { ARTWORK_CARD_FIELDS, toCard } from '../services/artworkQuery.js';

const loadWishlist = async (userId) =>
  (await Wishlist.findOne({ user: userId })) ?? (await Wishlist.create({ user: userId, artworks: [] }));

export const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await loadWishlist(req.user._id);

  const items = await Artwork.find({ _id: { $in: wishlist.artworks }, status: 'published' })
    .select(ARTWORK_CARD_FIELDS)
    .populate('artist', 'displayName slug')
    .populate('category', 'name slug')
    .lean();

  // Preserve the order the customer saved them in.
  const order = new Map(wishlist.artworks.map((id, index) => [String(id), index]));
  items.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

  res.json({ items: items.map(toCard), total: items.length });
});

export const toggleWishlist = asyncHandler(async (req, res) => {
  const { artworkId } = req.body;

  const artwork = await Artwork.findById(artworkId).select('_id status');
  if (!artwork || artwork.status !== 'published') throw ApiError.notFound('That artwork is not available.');

  const wishlist = await loadWishlist(req.user._id);
  const index = wishlist.artworks.findIndex((id) => String(id) === String(artwork._id));
  const added = index === -1;

  if (added) wishlist.artworks.unshift(artwork._id);
  else wishlist.artworks.splice(index, 1);

  await wishlist.save();
  await Artwork.updateOne({ _id: artwork._id }, { $inc: { 'stats.wishlists': added ? 1 : -1 } });

  res.json({ added, total: wishlist.artworks.length });
});

export const removeFromWishlist = asyncHandler(async (req, res) => {
  const wishlist = await loadWishlist(req.user._id);
  const before = wishlist.artworks.length;

  wishlist.artworks = wishlist.artworks.filter((id) => String(id) !== req.params.artworkId);

  if (wishlist.artworks.length !== before) {
    await wishlist.save();
    await Artwork.updateOne({ _id: req.params.artworkId }, { $inc: { 'stats.wishlists': -1 } });
  }

  res.json({ removed: wishlist.artworks.length !== before, total: wishlist.artworks.length });
});
