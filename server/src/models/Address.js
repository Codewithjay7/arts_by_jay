import mongoose from 'mongoose';

export const addressFields = {
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, trim: true, maxlength: 32 },
  line1: { type: String, required: true, trim: true, maxlength: 200 },
  line2: { type: String, default: '', trim: true, maxlength: 200 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  state: { type: String, required: true, trim: true, maxlength: 100 },
  postalCode: { type: String, required: true, trim: true, maxlength: 20 },
  country: { type: String, required: true, trim: true, maxlength: 60, default: 'India' },
};

/** Embedded snapshot used on orders — frozen at purchase time. */
export const addressSnapshotSchema = new mongoose.Schema(addressFields, { _id: false });

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, default: 'Home', maxlength: 40 },
    ...addressFields,
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

addressSchema.index({ user: 1, isDefault: -1 });

export default mongoose.model('Address', addressSchema);
