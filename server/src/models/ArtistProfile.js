import mongoose from 'mongoose';
import slugify from 'slugify';

export const ARTIST_STATUS = ['pending', 'approved', 'rejected', 'suspended'];

const artistProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    displayName: { type: String, required: [true, 'Artist name is required.'], trim: true, maxlength: 120 },
    slug: { type: String, unique: true, index: true },
    bio: { type: String, default: '', maxlength: 4000 },
    statement: { type: String, default: '', maxlength: 2000 },
    location: { type: String, default: '', trim: true, maxlength: 120 },
    avatarUrl: { type: String, default: '' },
    coverUrl: { type: String, default: '' },
    specialities: { type: [String], default: [] },
    links: {
      website: { type: String, default: '' },
      instagram: { type: String, default: '' },
      behance: { type: String, default: '' },
    },
    acceptsCommissions: { type: Boolean, default: true },
    commissionNote: { type: String, default: '', maxlength: 1000 },

    status: { type: String, enum: ARTIST_STATUS, default: 'pending', index: true },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, default: '' },

    isFeatured: { type: Boolean, default: false, index: true },

    // Denormalised counters, recalculated by the order/artwork services rather
    // than trusted from the client.
    stats: {
      publishedArtworks: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
      // Minor units (paise/cents).
      lifetimeEarningsMinor: { type: Number, default: 0 },
      pendingEarningsMinor: { type: Number, default: 0 },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

artistProfileSchema.index({ displayName: 'text', bio: 'text', specialities: 'text' });

/** Builds a URL-safe, collision-free slug from the display name. */
artistProfileSchema.pre('validate', async function ensureSlug(next) {
  if (this.slug && !this.isModified('displayName')) return next();

  const base = slugify(this.displayName || 'artist', { lower: true, strict: true }) || 'artist';
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

export default mongoose.model('ArtistProfile', artistProfileSchema);
