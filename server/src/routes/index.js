import { Router } from 'express';

import env, { configWarnings } from '../config/env.js';
import { isDatabaseReady } from '../config/db.js';
import { optionalAuth, requireAuth, requireRole, requireApprovedArtist } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { uploadSingle, uploadMany } from '../middleware/upload.js';
import {
  authLimiter,
  writeLimiter,
  uploadLimiter,
  checkoutLimiter,
} from '../middleware/rateLimit.js';
import { describePaymentCapability } from '../services/payments/index.js';
import * as v from '../validators/index.js';

import * as auth from '../controllers/auth.controller.js';
import * as artwork from '../controllers/artwork.controller.js';
import * as cart from '../controllers/cart.controller.js';
import * as wishlist from '../controllers/wishlist.controller.js';
import * as account from '../controllers/account.controller.js';
import * as checkout from '../controllers/checkout.controller.js';
import * as payment from '../controllers/payment.controller.js';
import * as order from '../controllers/order.controller.js';
import * as artist from '../controllers/artist.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as gallery from '../controllers/gallery.controller.js';
import * as misc from '../controllers/misc.controller.js';

const router = Router();

/* ──────────────────────────── Meta ──────────────────────────── */

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    database: isDatabaseReady() ? 'connected' : 'disconnected',
    environment: env.nodeEnv,
    time: new Date().toISOString(),
  });
});

/**
 * Tells the client which integrations are genuinely available, so the UI can
 * disable or explain a feature instead of pretending it works.
 */
router.get('/capabilities', (_req, res) => {
  res.json({
    payment: describePaymentCapability(),
    storage: { driver: env.storage.driver, maxUploadMb: env.storage.maxUploadMb },
    aiPhotoStudio: Boolean(env.ai.provider && env.ai.apiKey),
    emailDelivery: Boolean(env.mail.smtpUrl),
    currency: env.payments.currency,
    ...(env.isDev ? { developmentWarnings: configWarnings } : {}),
  });
});

/* ──────────────────────────── Auth ──────────────────────────── */

router.post('/auth/register', authLimiter, validateBody(v.registerSchema), auth.register);
router.post('/auth/login', authLimiter, validateBody(v.loginSchema), auth.login);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', requireAuth, auth.me);
router.post(
  '/auth/change-password',
  authLimiter,
  requireAuth,
  validateBody(v.changePasswordSchema),
  auth.changePassword,
);

/* ────────────────────── Public catalogue ────────────────────── */

router.get('/artworks', validateQuery(v.browseQuerySchema), artwork.browseArtworks);
router.get('/artworks/facets', artwork.getFilterFacets);
router.get('/artworks/collections', artwork.getHomeCollections);
router.get('/artworks/:idOrSlug', optionalAuth, artwork.getArtworkDetail);

router.get('/categories', misc.listCategories);

router.get('/artists', artist.listArtists);
router.get('/artists/:slug', artist.getArtistStorefront);

/* ─────────────────── Immersive virtual gallery ─────────────────── */

router.get('/gallery', gallery.getGallery);
router.get('/gallery/artworks/:id', gallery.getGalleryArtwork);

/* ──────────────────────── Photo studio ──────────────────────── */

router.get('/studio/config', misc.getStudioConfig);

/* ──────────────────────── Customer cart ──────────────────────── */

router.get('/cart', requireAuth, cart.getCart);
router.post('/cart/items', requireAuth, writeLimiter, validateBody(v.addToCartSchema), cart.addToCart);
router.patch(
  '/cart/items/:artworkId',
  requireAuth,
  writeLimiter,
  validateBody(v.updateCartItemSchema),
  cart.updateCartItem,
);
router.delete('/cart/items/:artworkId', requireAuth, cart.removeCartItem);
router.delete('/cart', requireAuth, cart.clearCart);

/* ──────────────────────────── Wishlist ──────────────────────────── */

router.get('/wishlist', requireAuth, wishlist.getWishlist);
router.post('/wishlist', requireAuth, writeLimiter, validateBody(v.wishlistToggleSchema), wishlist.toggleWishlist);
router.delete('/wishlist/:artworkId', requireAuth, wishlist.removeFromWishlist);

/* ──────────────────────────── Account ──────────────────────────── */

router.get('/account/summary', requireAuth, account.getAccountSummary);
router.patch('/account/profile', requireAuth, writeLimiter, validateBody(v.profileUpdateSchema), account.updateProfile);
router.post('/account/avatar', requireAuth, uploadLimiter, uploadSingle('image'), account.uploadAvatar);

router.get('/account/addresses', requireAuth, account.listAddresses);
router.post('/account/addresses', requireAuth, writeLimiter, validateBody(v.addressWriteSchema), account.createAddress);
router.patch(
  '/account/addresses/:id',
  requireAuth,
  writeLimiter,
  validateBody(v.addressWriteSchema.partial()),
  account.updateAddress,
);
router.delete('/account/addresses/:id', requireAuth, account.deleteAddress);

router.get('/account/reviews', requireAuth, misc.listMyReviews);
router.get('/account/commissions', requireAuth, misc.listMyCommissionRequests);

/* ──────────────────────── Checkout & payment ──────────────────────── */

router.get('/checkout/config', checkout.getCheckoutConfig);
router.get('/checkout/review', requireAuth, checkout.reviewCheckout);
router.post(
  '/checkout',
  requireAuth,
  checkoutLimiter,
  validateBody(v.checkoutSchema),
  checkout.createCheckout,
);

router.post(
  '/payments/confirm',
  requireAuth,
  checkoutLimiter,
  validateBody(v.confirmPaymentSchema),
  payment.confirmPayment,
);
router.post(
  '/payments/cancel',
  requireAuth,
  writeLimiter,
  validateBody(v.cancelPaymentSchema),
  payment.cancelPayment,
);

/* ──────────────────────────── Orders ──────────────────────────── */

router.get('/orders', requireAuth, order.listMyOrders);
router.get('/orders/:orderNumber', requireAuth, order.getMyOrder);
router.post(
  '/orders/:orderNumber/cancel',
  requireAuth,
  writeLimiter,
  validateBody(v.cancelOrderSchema),
  order.cancelMyOrder,
);

/* ──────────────────────────── Reviews ──────────────────────────── */

router.post('/reviews', requireAuth, writeLimiter, validateBody(v.reviewWriteSchema), misc.createReview);
router.delete('/reviews/:id', requireAuth, misc.deleteMyReview);

/* ──────────────────── Commissions & enquiries ──────────────────── */

router.post(
  '/commissions',
  optionalAuth,
  uploadLimiter,
  uploadMany('photos', 4),
  validateBody(v.commissionCreateSchema),
  misc.createCommissionRequest,
);

/* ──────────────────────── Notifications ──────────────────────── */

router.get('/notifications', requireAuth, misc.listNotifications);
router.post('/notifications/read', requireAuth, validateBody(v.markReadSchema), misc.markNotificationsRead);

/* ──────────────────────── Artist dashboard ──────────────────────── */

const artistOnly = [requireAuth, requireRole('artist', 'admin')];
const artistApproved = [...artistOnly, requireApprovedArtist];

router.get('/artist/overview', artistOnly, artist.getArtistOverview);

router.get('/artist/profile', artistOnly, artist.getMyArtistProfile);
router.post(
  '/artist/profile',
  requireAuth,
  writeLimiter,
  validateBody(v.artistProfileWriteSchema),
  artist.createMyArtistProfile,
);
router.patch(
  '/artist/profile',
  artistOnly,
  writeLimiter,
  validateBody(v.artistProfileUpdateSchema),
  artist.updateMyArtistProfile,
);
router.post(
  '/artist/profile/image/:field',
  artistOnly,
  uploadLimiter,
  uploadSingle('image'),
  artist.uploadArtistImage,
);

router.get('/artist/artworks', artistOnly, artist.listMyArtworks);
router.get('/artist/artworks/:id', artistOnly, artist.getMyArtwork);
router.post(
  '/artist/artworks',
  artistApproved,
  writeLimiter,
  validateBody(v.artworkWriteSchema),
  artist.createMyArtwork,
);
router.patch(
  '/artist/artworks/:id',
  artistOnly,
  writeLimiter,
  validateBody(v.artworkUpdateSchema),
  artist.updateMyArtwork,
);
router.post(
  '/artist/artworks/:id/images',
  artistOnly,
  uploadLimiter,
  uploadMany('images', 8),
  artist.addArtworkImages,
);
router.delete('/artist/artworks/:id/images/:index', artistOnly, artist.removeArtworkImage);
router.post(
  '/artist/artworks/:id/status',
  artistApproved,
  writeLimiter,
  validateBody(v.publishSchema),
  artist.setMyArtworkStatus,
);
router.delete('/artist/artworks/:id', artistOnly, artist.deleteMyArtwork);

router.get('/artist/orders', artistOnly, order.listArtistOrders);
router.patch(
  '/artist/orders/:orderId/items/:itemId',
  artistOnly,
  writeLimiter,
  validateBody(v.artistOrderItemSchema),
  order.updateArtistOrderItem,
);

router.get('/artist/enquiries', artistOnly, misc.listArtistEnquiries);
router.patch(
  '/artist/enquiries/:id',
  artistOnly,
  writeLimiter,
  validateBody(v.enquiryResponseSchema),
  misc.respondToEnquiry,
);

router.post('/uploads/images', artistOnly, uploadLimiter, uploadMany('images', 8), misc.uploadImages);

/* ──────────────────────── Admin dashboard ──────────────────────── */

const adminOnly = [requireAuth, requireRole('admin')];

router.get('/admin/overview', adminOnly, admin.getOverview);
router.get('/admin/settings', adminOnly, admin.getPlatformSettings);

router.get('/admin/users', adminOnly, admin.listUsers);
router.patch('/admin/users/:id', adminOnly, validateBody(v.adminUserUpdateSchema), admin.updateUser);

router.get('/admin/artists', adminOnly, admin.listArtistApplications);
router.post(
  '/admin/artists/:id/review',
  adminOnly,
  validateBody(v.artistReviewSchema),
  admin.reviewArtistApplication,
);

router.get('/admin/artworks', adminOnly, admin.listArtworksForModeration);
router.post(
  '/admin/artworks/:id/moderate',
  adminOnly,
  validateBody(v.moderateArtworkSchema),
  admin.moderateArtwork,
);

router.post('/admin/categories', adminOnly, validateBody(v.categoryWriteSchema), admin.createCategory);
router.patch(
  '/admin/categories/:id',
  adminOnly,
  validateBody(v.categoryWriteSchema.partial()),
  admin.updateCategory,
);
router.delete('/admin/categories/:id', adminOnly, admin.deleteCategory);

router.get('/admin/orders', adminOnly, validateQuery(v.adminOrderQuerySchema), admin.listAllOrders);
router.get('/admin/orders/:orderNumber', adminOnly, admin.getOrderForAdmin);
router.post(
  '/admin/orders/:orderNumber/refund',
  adminOnly,
  validateBody(v.refundSchema),
  admin.refundOrder,
);

router.post('/admin/reviews/:id/hide', adminOnly, validateBody(v.hideReviewSchema), admin.hideReview);

router.get('/admin/reports/sales', adminOnly, admin.getSalesReport);

export default router;
