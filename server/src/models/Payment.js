import mongoose from 'mongoose';

export const PAYMENT_STATUS = ['created', 'pending', 'captured', 'failed', 'refunded', 'cancelled'];
export const PAYMENT_PROVIDERS = ['razorpay', 'stripe', 'dev'];

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    // The gateway own order/intent identifier.
    providerOrderId: { type: String, default: '', index: true },
    // The gateway payment identifier, present once the charge exists.
    providerPaymentId: { type: String, default: '', index: true },

    amountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true },

    status: { type: String, enum: PAYMENT_STATUS, default: 'created', index: true },
    failureReason: { type: String, default: '' },

    // Set only by a verified webhook or a verified server-side signature
    // check. A client-reported success never sets this.
    verifiedAt: { type: Date, default: null },
    verifiedVia: { type: String, enum: ['', 'webhook', 'signature', 'simulation'], default: '' },

    refundedAmountMinor: { type: Number, default: 0, min: 0 },
    refunds: [
      {
        _id: false,
        providerRefundId: String,
        amountMinor: Number,
        reason: String,
        at: { type: Date, default: Date.now },
      },
    ],

    // Non-sensitive gateway echo only. Card numbers, CVVs and the like are
    // never received by this server, let alone stored.
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // De-duplicates replayed webhook deliveries.
    processedEventIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model('Payment', paymentSchema);
