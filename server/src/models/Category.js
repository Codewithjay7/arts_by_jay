import mongoose from 'mongoose';
import slugify from 'slugify';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 1000 },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    imageUrl: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
    artworkCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

categorySchema.pre('validate', async function ensureSlug(next) {
  if (this.slug && !this.isModified('name')) return next();

  const base = slugify(this.name || 'category', { lower: true, strict: true }) || 'category';
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

export default mongoose.model('Category', categorySchema);
