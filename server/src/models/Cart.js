import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    artwork: { type: mongoose.Schema.Types.ObjectId, ref: 'Artwork', required: true },
    quantity: { type: Number, required: true, min: 1, max: 50, default: 1 },
    // Price captured when the item was added, so we can tell the customer
    // "this price changed" instead of silently charging the new one.
    priceAtAddMinor: { type: Number, required: true, min: 0 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model('Cart', cartSchema);
