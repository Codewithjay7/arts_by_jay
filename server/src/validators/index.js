import { z } from 'zod';
import {
  objectId,
  shortText,
  longText,
  priceMajor,
  boolish,
  listOfStrings,
  addressSchema,
} from './common.js';
import { ARTIST_STATUS } from '../models/ArtistProfile.js';
import { COMMISSION_KINDS, COMMISSION_STATUS } from '../models/CommissionRequest.js';
import { FULFILMENT_STATUS, ORDER_STATUS } from '../models/Order.js';
import { ROLES } from '../models/User.js';

export * from './common.js';
export * from './auth.validators.js';
export * from './artwork.validators.js';

/* ───────────────────────────── Account ───────────────────────────── */

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120).optional(),
  phone: shortText(32).optional(),
});

export const addressWriteSchema = addressSchema.extend({
  label: shortText(40).optional().default('Home'),
  isDefault: boolish.optional().default(false),
});

/* ───────────────────────────── Cart ───────────────────────────── */

export const addToCartSchema = z.object({
  artworkId: objectId,
  quantity: z.coerce.number().int().min(1).max(50).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(50),
});

export const wishlistToggleSchema = z.object({ artworkId: objectId });

/* ─────────────────────────── Checkout ─────────────────────────── */

export const checkoutSchema = z.object({
  shippingAddress: addressSchema,
  billingAddress: addressSchema.nullable().optional(),
  shippingMethod: z.enum(['standard', 'express']).default('standard'),
  customerNote: longText(1000).optional().default(''),
  // Client-generated per checkout attempt; makes a double submit safe.
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const confirmPaymentSchema = z.object({
  orderId: objectId,
  providerOrderId: shortText(200).optional().default(''),
  providerPaymentId: shortText(200).optional().default(''),
  signature: shortText(400).optional().default(''),
});

export const cancelPaymentSchema = z.object({ orderId: objectId });

/* ──────────────────────────── Orders ──────────────────────────── */

export const cancelOrderSchema = z.object({
  reason: longText(500).optional().default(''),
});

export const artistOrderItemSchema = z.object({
  fulfilmentStatus: z.enum(FULFILMENT_STATUS).optional(),
  trackingCarrier: shortText(80).optional(),
  trackingNumber: shortText(120).optional(),
  note: longText(500).optional(),
});

/* ──────────────────────── Artist profile ──────────────────────── */

/**
 * Status, stats and review fields are intentionally absent: an artist cannot
 * approve themselves or write their own earnings by posting extra fields.
 */
export const artistProfileWriteSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter your artist name.').max(120),
  bio: longText(4000).optional().default(''),
  statement: longText(2000).optional().default(''),
  location: shortText(120).optional().default(''),
  specialities: listOfStrings(10).optional().default([]),
  links: z
    .object({
      website: z.string().trim().url('Enter a valid URL.').max(300).or(z.literal('')).optional().default(''),
      instagram: shortText(300).optional().default(''),
      behance: shortText(300).optional().default(''),
    })
    .optional(),
  acceptsCommissions: boolish.optional().default(true),
  commissionNote: longText(1000).optional().default(''),
});

export const artistProfileUpdateSchema = artistProfileWriteSchema.partial();

/* ──────────────────────────── Reviews ──────────────────────────── */

export const reviewWriteSchema = z.object({
  artworkId: objectId,
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  title: shortText(160).optional().default(''),
  body: longText(4000).optional().default(''),
});

/* ────────────────────────── Commissions ────────────────────────── */

export const commissionCreateSchema = z.object({
  kind: z.enum(COMMISSION_KINDS).default('commission'),
  contactName: z.string().trim().min(2, 'Enter your name.').max(120),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  contactPhone: shortText(32).optional().default(''),
  artistId: objectId.optional(),
  artworkId: objectId.optional(),
  subject: shortText(180).optional().default(''),
  message: z.string().trim().min(10, 'Tell the studio a little about what you have in mind.').max(5000),
  styleKey: shortText(60).optional().default(''),
  preferredSize: shortText(120).optional().default(''),
  budget: priceMajor.nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  photoConsent: boolish.optional().default(false),
});

export const enquiryResponseSchema = z.object({
  status: z.enum(COMMISSION_STATUS).optional(),
  quotedAmount: priceMajor.nullable().optional(),
  quoteNote: longText(2000).optional(),
  reply: longText(5000).optional(),
});

/* ──────────────────────── Notifications ──────────────────────── */

export const markReadSchema = z.object({
  ids: z.array(objectId).max(100).optional(),
});

/* ───────────────────────────── Admin ───────────────────────────── */

export const adminUserUpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  isActive: boolish.optional(),
  suspendedReason: longText(500).optional(),
});

export const artistReviewSchema = z.object({
  decision: z.enum(ARTIST_STATUS.filter((status) => status !== 'pending')),
  note: longText(1000).optional().default(''),
});

export const moderateArtworkSchema = z.object({
  decision: z.enum(['approve', 'reject', 'unpublish', 'feature']),
  note: longText(1000).optional().default(''),
});

export const categoryWriteSchema = z.object({
  name: z.string().trim().min(2, 'Enter a category name.').max(80),
  description: longText(1000).optional().default(''),
  parent: objectId.nullable().optional(),
  imageUrl: z.string().trim().url().max(500).or(z.literal('')).optional().default(''),
  isFeatured: boolish.optional().default(false),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
});

export const refundSchema = z.object({
  amount: priceMajor.nullable().optional(),
  reason: longText(500).optional().default(''),
});

export const hideReviewSchema = z.object({
  isHidden: boolish.optional().default(true),
  reason: longText(500).optional().default(''),
});

export const adminOrderQuerySchema = z.object({
  status: z.enum(ORDER_STATUS).optional(),
  q: shortText(120).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(20),
});
