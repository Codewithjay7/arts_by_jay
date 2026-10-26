import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { Cart, Artwork } from '../models/index.js';
import { priceCart, SHIPPING_METHODS } from '../services/pricing.js';
import { toCard } from '../services/artworkQuery.js';

const CART_POPULATE = {
  path: 'items.artwork',
  // `isUnique` must be selected: without it the quantity cap below silently
  // sees `undefined` and stops enforcing one-per-buyer on originals.
  select:
    'title slug priceMinor compareAtPriceMinor currency images type medium style stock allowBackorder isUnique status orientation dimensions shipping stats artist category',
  populate: [
    { path: 'artist', select: 'displayName slug' },
    { path: 'category', select: 'name slug' },
  ],
};

const loadCart = async (userId) => {
  const cart =
    (await Cart.findOne({ user: userId }).populate(CART_POPULATE)) ??
    (await Cart.create({ user: userId, items: [] }));

  if (!cart.populated('items.artwork')) await cart.populate(CART_POPULATE);
  return cart;
};

/**
 * Prices the cart server-side and, when the server had to adjust quantities,
 * writes those adjustments back so the stored cart matches what the customer
 * was just shown.
 */
const respondWithCart = async (res, cart, { shippingMethod = 'standard' } = {}) => {
  const priced = priceCart(cart, { shippingMethod });

  const keptIds = new Set(priced.lines.map((line) => String(line.artwork._id)));
  const adjustments = new Map(priced.lines.map((line) => [String(line.artwork._id), line.quantity]));

  const before = cart.items.length;
  cart.items = cart.items
    .filter((item) => item.artwork && keptIds.has(String(item.artwork._id)))
    .map((item) => {
      const quantity = adjustments.get(String(item.artwork._id));
      if (quantity && quantity !== item.quantity) item.quantity = quantity;
      return item;
    });

  const changed =
    before !== cart.items.length || priced.issues.some((issue) => issue.kind === 'quantity_reduced');
  if (changed) await cart.save();

  res.json({
    items: priced.lines.map((line) => ({
      artwork: toCard(line.artwork),
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      shippingMinor: line.shippingMinor,
      isDigital: line.isDigital,
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
    shippingMethod: priced.shippingMethod,
    shippingMethods: SHIPPING_METHODS,
  });
};

export const getCart = asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user._id);
  await respondWithCart(res, cart, { shippingMethod: req.query.shippingMethod });
});

export const addToCart = asyncHandler(async (req, res) => {
  const { artworkId, quantity } = req.body;

  const artwork = await Artwork.findById(artworkId);
  if (!artwork || artwork.status !== 'published') {
    throw ApiError.notFound('That artwork is not available.');
  }
  if (artwork.type === 'commission') {
    throw ApiError.badRequest('Commissions are arranged with the artist rather than added to the cart.');
  }

  const digital = Boolean(artwork.shipping?.isDigitalDelivery);
  if (!digital && !artwork.allowBackorder && artwork.stock <= 0) {
    throw ApiError.conflict('That piece has sold out.');
  }

  const cart = await loadCart(req.user._id);
  const existing = cart.items.find((item) => String(item.artwork?._id ?? item.artwork) === String(artwork._id));

  let desired = (existing?.quantity ?? 0) + quantity;

  if (!digital && !artwork.allowBackorder) {
    desired = Math.min(desired, artwork.stock);
  }
  // An original is unique: a buyer can only ever hold one.
  if (artwork.isUnique) desired = 1;

  if (existing) {
    existing.quantity = desired;
    existing.priceAtAddMinor = artwork.priceMinor;
  } else {
    cart.items.push({ artwork: artwork._id, quantity: desired, priceAtAddMinor: artwork.priceMinor });
  }

  await cart.save();
  await cart.populate(CART_POPULATE);
  await respondWithCart(res, cart);
});

export const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const cart = await loadCart(req.user._id);

  const item = cart.items.find((entry) => String(entry.artwork?._id ?? entry.artwork) === req.params.artworkId);
  if (!item) throw ApiError.notFound('That item is not in your cart.');

  if (quantity === 0) {
    cart.items = cart.items.filter((entry) => entry !== item);
  } else {
    const artwork = item.artwork;
    const digital = Boolean(artwork?.shipping?.isDigitalDelivery);
    let next = quantity;

    if (artwork?.isUnique) next = 1;
    else if (artwork && !digital && !artwork.allowBackorder) next = Math.min(next, Math.max(0, artwork.stock));

    if (next <= 0) {
      cart.items = cart.items.filter((entry) => entry !== item);
    } else {
      item.quantity = next;
    }
  }

  await cart.save();
  await cart.populate(CART_POPULATE);
  await respondWithCart(res, cart);
});

export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user._id);
  cart.items = cart.items.filter((item) => String(item.artwork?._id ?? item.artwork) !== req.params.artworkId);
  await cart.save();
  await cart.populate(CART_POPULATE);
  await respondWithCart(res, cart);
});

export const clearCart = asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user._id);
  cart.items = [];
  await cart.save();
  await respondWithCart(res, cart);
});
