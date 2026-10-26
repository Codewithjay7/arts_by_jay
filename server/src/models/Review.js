import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    artwork: { type: mongoose.Schema.Types.ObjectId, ref: 'Artwork', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The delivered order that entitles this review. Required, because only
    // verified buyers may review a piece.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: '', maxlength: 160 },
    body: { type: String, default: '', maxlength: 4000 },

    isVerifiedPurchase: { type: Boolean, default: true },
    isHidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: '' },
  },
  { timestamps: true },
);

// One review per buyer per artwork.
reviewSchema.index({ artwork: 1, author: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);
