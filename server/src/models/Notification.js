import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'order_placed',
  'order_paid',
  'order_status',
  'artwork_approved',
  'artwork_rejected',
  'artist_approved',
  'artist_rejected',
  'commission_received',
  'commission_update',
  'review_received',
  'account_notice',
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    // Relative client path, for example /artist/orders.
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
