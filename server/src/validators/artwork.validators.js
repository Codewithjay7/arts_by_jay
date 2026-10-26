import { z } from 'zod';
import { objectId, shortText, longText, priceMajor, boolish, listOfStrings } from './common.js';
import { ARTWORK_TYPES, ORIENTATIONS } from '../models/Artwork.js';

export const browseQuerySchema = z.object({
  q: shortText(120).optional().default(''),
  category: shortText(80).optional().default(''),
  artist: shortText(120).optional().default(''),
  type: z.enum(['', ...ARTWORK_TYPES]).optional().default(''),
  medium: shortText(120).optional().default(''),
  style: shortText(80).optional().default(''),
  tags: listOfStrings(10).optional().default([]),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  availability: z.enum(['', 'available', 'sold']).optional().default(''),
  orientation: z.enum(['', ...ORIENTATIONS]).optional().default(''),
  featured: boolish.optional(),
  sort: z
    .enum(['newest', 'oldest', 'price_asc', 'price_desc', 'popular', 'relevance'])
    .optional()
    .default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(12),
});

const dimensionsSchema = z
  .object({
    width: z.coerce.number().min(0).max(10000).nullable().optional(),
    height: z.coerce.number().min(0).max(10000).nullable().optional(),
    depth: z.coerce.number().min(0).max(10000).nullable().optional(),
    unit: z.enum(['cm', 'in']).optional().default('cm'),
  })
  .optional();

const shippingSchema = z
  .object({
    shipsFrom: shortText(120).optional().default(''),
    processingDays: z.coerce.number().int().min(0).max(90).optional().default(3),
    flatRate: priceMajor.optional().default(0),
    isDigitalDelivery: boolish.optional().default(false),
  })
  .optional();

/**
 * Note what is absent: status, owner, artist, publishedAt, stats and
 * moderation are never accepted from the client. They are set by the server.
 */
export const artworkWriteSchema = z.object({
  title: z.string().trim().min(2, 'Give the piece a title.').max(180),
  description: longText(8000).optional().default(''),
  story: longText(4000).optional().default(''),
  category: objectId,
  type: z.enum(ARTWORK_TYPES).default('original'),
  style: shortText(80).optional().default(''),
  medium: shortText(120).optional().default(''),
  year: z.coerce.number().int().min(1800).max(2200).optional(),
  tags: listOfStrings(15).optional().default([]),
  price: priceMajor,
  compareAtPrice: priceMajor.nullable().optional(),
  stock: z.coerce.number().int().min(0).max(9999).optional().default(1),
  allowBackorder: boolish.optional().default(false),
  dimensions: dimensionsSchema,
  weightGrams: z.coerce.number().min(0).max(500000).nullable().optional(),
  orientation: z.enum(ORIENTATIONS).optional().default('portrait'),
  isFramed: boolish.optional().default(false),
  shipping: shippingSchema,
  inVirtualGallery: boolish.optional().default(true),
  // Images already uploaded via /api/uploads, referenced by url + publicId.
  images: z
    .array(
      z.object({
        url: z.string().url('Each image needs a valid URL.'),
        thumbUrl: z.string().url().optional().default(''),
        publicId: shortText(300).optional().default(''),
        width: z.coerce.number().int().min(0).optional().default(0),
        height: z.coerce.number().int().min(0).optional().default(0),
        alt: shortText(300).optional().default(''),
      }),
    )
    .max(8)
    .optional()
    .default([]),
});

export const artworkUpdateSchema = artworkWriteSchema.partial();

export const publishSchema = z.object({
  action: z.enum(['publish', 'unpublish', 'submit', 'archive']),
});
