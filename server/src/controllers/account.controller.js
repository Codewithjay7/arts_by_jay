import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { Address, Order, Wishlist, Notification } from '../models/index.js';
import { storeImage, removeImage } from '../services/storage.js';

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;

  // Only these two fields are writable here. Role, email verification state
  // and activity flags are not client-editable.
  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;

  await req.user.save();
  res.json({ user: req.user.toPublic() });
});

export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');

  const stored = await storeImage(req.file, { folder: `avatars/${req.user._id}` });
  const previous = req.user.avatarUrl;

  req.user.avatarUrl = stored.url;
  await req.user.save();

  if (previous && stored.publicId) {
    // Best effort: the old file is no longer referenced.
    removeImage(previous.split('/uploads/')[1] ?? '').catch(() => {});
  }

  res.json({ user: req.user.toPublic(), image: stored });
});

export const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: -1 }).lean();
  res.json({
    items: addresses.map((address) => ({ ...address, id: String(address._id), _id: undefined })),
  });
});

export const createAddress = asyncHandler(async (req, res) => {
  const count = await Address.countDocuments({ user: req.user._id });
  if (count >= 20) throw ApiError.badRequest('You have reached the maximum number of saved addresses.');

  const address = await Address.create({
    ...req.body,
    user: req.user._id,
    // The first address saved becomes the default automatically.
    isDefault: count === 0 ? true : Boolean(req.body.isDefault),
  });

  if (address.isDefault) {
    await Address.updateMany({ user: req.user._id, _id: { $ne: address._id } }, { $set: { isDefault: false } });
  }

  res.status(201).json({ address: { ...address.toObject(), id: String(address._id) } });
});

export const updateAddress = asyncHandler(async (req, res) => {
  // Scoped by user id, so one customer can never edit another's address.
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw ApiError.notFound('That address was not found.');

  Object.assign(address, req.body);
  await address.save();

  if (address.isDefault) {
    await Address.updateMany({ user: req.user._id, _id: { $ne: address._id } }, { $set: { isDefault: false } });
  }

  res.json({ address: { ...address.toObject(), id: String(address._id) } });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const result = await Address.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) throw ApiError.notFound('That address was not found.');
  res.json({ ok: true });
});

/** Counts for the account menu badges. */
export const getAccountSummary = asyncHandler(async (req, res) => {
  const [orderCount, activeOrders, wishlist, unreadNotifications] = await Promise.all([
    Order.countDocuments({ customer: req.user._id }),
    Order.countDocuments({ customer: req.user._id, status: { $in: ['paid', 'processing', 'shipped'] } }),
    Wishlist.findOne({ user: req.user._id }).select('artworks').lean(),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);

  res.json({
    orderCount,
    activeOrders,
    wishlistCount: wishlist?.artworks?.length ?? 0,
    unreadNotifications,
  });
});
