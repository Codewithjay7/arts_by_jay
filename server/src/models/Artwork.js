import mongoose from 'mongoose';
import slugify from 'slugify';

export const ARTWORK_TYPES = ['original', 'print', 'digital', 'commission'];
export const ARTWORK_STATUS = ['draft', 'pending', 'published', 'rejected', 'unpublished', 'archived'];
export const ORIENTATIONS = ['portrait', 'landscape', 'square'];

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    thumbUrl: { type: String, default: '' },
    publicId: { type: String, default: '' },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    alt: { type: String, default: '', maxlength: 300 },
  },
  { _id: false },
);

const artworkSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required.'], trim: true, maxlength: 180 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 8000 },
    // The narrative shown in the immersive gallery's detail view.
    story: { type: String, default: '', maxlength: 4000 },

    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtistProfile', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    style: { type: String, default: '', trim: true, maxlength: 80, index: true },
    medium: { type: String, default: '', trim: true, maxlength: 120, index: true },
    year: { type: Number, min: 1800, max: 2200 },
    tags: { type: [String], default: [], index: true },

    type: { type: String, enum: ARTWORK_TYPES, default: 'original', index: true },
    // Price in minor units (paise for INR). Integers only — never floats.
    priceMinor: { type: Number, required: true, min: 0 },
    compareAtPriceMinor: { type: Number, default: null, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },

    // An original is unique: stock is forced to 1 and it sells out permanently.
    stock: { type: Number, default: 1, min: 0 },
    // Only an original is one-of-a-kind. Editions and digital goods are not,
    // so this must default to false — a `true` default silently capped every
    // print at a quantity of one.
    isUnique: { type: Boolean, default: false },
    allowBackorder: { type: Boolean, default: false },

    dimensions: {
      width: { type: Number, default: null, min: 0 },
      height: { type: Number, default: null, min: 0 },
      depth: { type: Number, default: null, min: 0 },
      unit: { type: String, default: 'cm', enum: ['cm', 'in'] },
    },
    weightGrams: { type: Number, default: null, min: 0 },
    orientation: { type: String, enum: ORIENTATIONS, default: 'portrait' },
    isFramed: { type: Boolean, default: false },

    images: { type: [imageSchema], default: [] },

    shipping: {
      shipsFrom: { type: String, default: '' },
      processingDays: { type: Number, default: 3, min: 0, max: 90 },
      // Minor units. 0 means free shipping.
      flatRateMinor: { type: Number, default: 0, min: 0 },
      isDigitalDelivery: { type: Boolean, default: false },
    },

    status: { type: String, enum: ARTWORK_STATUS, default: 'draft', index: true },
    publishedAt: { type: Date, default: null },
    moderation: {
      reviewedAt: { type: Date },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, default: '' },
      reportCount: { type: Number, default: 0 },
    },

    isFeatured: { type: Boolean, default: false, index: true },
    // Opt the piece into the immersive virtual gallery walls.
    inVirtualGallery: { type: Boolean, default: true, index: true },

    stats: {
      views: { type: Number, default: 0 },
      wishlists: { type: Number, default: 0 },
      unitsSold: { type: Number, default: 0 },
      ratingAverage: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// Text search across the fields buyers actually type into the search bar.
artworkSchema.index(
  { title: 'text', description: 'text', tags: 'text', medium: 'text', style: 'text' },
  { weights: { title: 10, tags: 5, medium: 3, style: 3, description: 1 }, name: 'artwork_search' },
);
// Supports the storefront's default "published, newest first" listing.
artworkSchema.index({ status: 1, publishedAt: -1 });
artworkSchema.index({ status: 1, priceMinor: 1 });
artworkSchema.index({ artist: 1, status: 1 });

artworkSchema.virtual('isSoldOut').get(function isSoldOut() {
  if (this.shipping?.isDigitalDelivery) return false;
  if (this.allowBackorder) return false;
  return this.stock <= 0;
});

artworkSchema.virtual('isPurchasable').get(function isPurchasable() {
  return this.status === 'published' && this.type !== 'commission' && !this.isSoldOut;
});

artworkSchema.virtual('primaryImage').get(function primaryImage() {
  return this.images?.[0] ?? null;
});

artworkSchema.pre('validate', async function ensureSlug(next) {
  if (this.slug && !this.isModified('title')) return next();

  const base = slugify(this.title || 'artwork', { lower: true, strict: true }) || 'artwork';
  let candidate = base;
  let suffix = 1;

  /* eslint-disable no-await-in-loop */
  while (await this.constructor.exists({ slug: candidate, _id: { $ne: this._id } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  /* eslint-enable no-await-in-loop */

  this.slug = candidate;
  return next();
});

artworkSchema.pre('save', function normaliseInventory(next) {
  // An original is one-of-a-kind; a digital file never depletes. Uniqueness is
  // derived from the type rather than trusted from whatever was submitted.
  this.isUnique = this.type === 'original';
  if (this.type === 'original' && this.stock > 1) this.stock = 1;
  if (this.type === 'digital') {
    this.shipping.isDigitalDelivery = true;
  }
  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

export default mongoose.model('Artwork', artworkSchema);
