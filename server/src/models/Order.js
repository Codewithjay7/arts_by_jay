import mongoose from 'mongoose';
import { addressSnapshotSchema } from './Address.js';

export const ORDER_STATUS = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  // Reached once delivery is confirmed AND the return window has closed with
  // no open dispute. It means "the artist has earned this", not "paid out".
  'eligible_for_settlement',
  'settled',
  'disputed',
  'cancelled',
  'refunded',
];

export const FULFILMENT_STATUS = ['awaiting', 'preparing', 'shipped', 'delivered', 'cancelled'];

/**
 * Settlement state of an artist's share of one line item.
 *
 * This tracks our own obligation to the artist. It is deliberately separate
 * from the gateway's payment and settlement state, because a row in this
 * database has no power over real money — see services/payouts.js.
 */
export const SETTLEMENT_STATUS = [
  'pending', // delivery not confirmed, or the return window is still open
  'eligible', // earned and clear to pay
  'on_hold', // blocked by a dispute or a refund request
  'processing', // a transfer has been requested from the provider
  'transferred', // the provider has confirmed the transfer
  'failed', // the provider rejected or could not complete it
  'reversed', // refunded or clawed back after transfer
];

export const DELIVERY_CONFIRMATION_SOURCES = ['carrier', 'admin', 'customer'];

/**
 * Statuses an artist is allowed to move one of their own line items into.
 * Anything outside this map is admin-only.
 */
export const ARTIST_FULFILMENT_TRANSITIONS = {
  awaiting: ['preparing', 'shipped'],
  preparing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const orderItemSchema = new mongoose.Schema(
  {
    artwork: { type: mongoose.Schema.Types.ObjectId, ref: 'Artwork', required: true },
    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtistProfile', required: true, index: true },
    artistUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Immutable snapshot: the listing may later be edited, renamed or deleted.
    title: { type: String, required: true },
    slug: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    type: { type: String, default: 'original' },
    medium: { type: String, default: '' },

    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    lineTotalMinor: { type: Number, required: true, min: 0 },
    shippingMinor: { type: Number, default: 0, min: 0 },

    /**
     * Commission snapshot, frozen at purchase time.
     *
     * `commissionRatePercent` is stored per line item so that changing the
     * platform rate later can never alter what an artist was owed on a past
     * sale. `commissionBasisMinor` records exactly what the rate was applied
     * to (the artwork line total, excluding shipping), so the arithmetic on
     * any historical order stays reproducible.
     */
    commissionRatePercent: { type: Number, required: true, min: 0, max: 100 },
    commissionBasisMinor: { type: Number, required: true, min: 0 },
    commissionMinor: { type: Number, default: 0, min: 0 },
    earningsMinor: { type: Number, default: 0, min: 0 },

    fulfilmentStatus: { type: String, enum: FULFILMENT_STATUS, default: 'awaiting', index: true },
    trackingCarrier: { type: String, default: '' },
    trackingNumber: { type: String, default: '' },
    trackingUrl: { type: String, default: '' },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },

    /**
     * Delivery confirmation and the return window that follows it. Together
     * these decide when the artist's share becomes payable.
     */
    delivery: {
      confirmedAt: { type: Date, default: null },
      // Who or what confirmed it, so the decision is auditable later.
      confirmedVia: { type: String, enum: ['', ...DELIVERY_CONFIRMATION_SOURCES], default: '' },
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      // A carrier reference, a signature id, or a note from whoever confirmed.
      evidenceRef: { type: String, default: '' },
      returnWindowEndsAt: { type: Date, default: null },
      returnWindowDays: { type: Number, default: null },
    },

    /** Artist settlement state for this line. Not money movement. */
    settlement: {
      status: { type: String, enum: SETTLEMENT_STATUS, default: 'pending', index: true },
      becameEligibleAt: { type: Date, default: null },
      holdReason: { type: String, default: '' },
      // Razorpay Route transfer id, once Route is approved and a transfer runs.
      providerTransferId: { type: String, default: '' },
      providerStatus: { type: String, default: '' },
      transferredAt: { type: Date, default: null },
      failureReason: { type: String, default: '' },
      attempts: { type: Number, default: 0 },
      // Set when settlement happened outside the gateway (a manual bank
      // transfer), which is the only option while Route is unavailable.
      settledOutOfBand: { type: Boolean, default: false },
      note: { type: String, default: '' },
    },

    /** Set while a refund or delivery dispute is unresolved. Blocks payout. */
    dispute: {
      isOpen: { type: Boolean, default: false },
      openedAt: { type: Date, default: null },
      openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reason: { type: String, default: '' },
      resolvedAt: { type: Date, default: null },
      resolution: { type: String, default: '' },
    },

    refundedMinor: { type: Number, default: 0, min: 0 },
    history: [
      {
        _id: false,
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],
  },
  { _id: true },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerEmail: { type: String, required: true },

    items: { type: [orderItemSchema], default: [] },

    subtotalMinor: { type: Number, required: true, min: 0 },
    shippingTotalMinor: { type: Number, default: 0, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true },

    shippingAddress: { type: addressSnapshotSchema, required: true },
    billingAddress: { type: addressSnapshotSchema, default: null },
    shippingMethod: { type: String, default: 'standard' },
    customerNote: { type: String, default: '', maxlength: 1000 },

    status: { type: String, enum: ORDER_STATUS, default: 'pending_payment', index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    paidAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String, default: '' },

    // True when PAYMENT_PROVIDER=dev produced this order. Surfaced in every
    // UI that shows the order so a simulated sale is never mistaken for real.
    isSimulatedPayment: { type: Boolean, default: false },

    // Guards against a double-submitted checkout creating two orders.
    idempotencyKey: { type: String, index: true, sparse: true },

    history: [
      {
        _id: false,
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'items.artistUser': 1, createdAt: -1 });
// Supports the payout sweep: "which line items are now payable?"
orderSchema.index({ 'items.settlement.status': 1, 'items.delivery.returnWindowEndsAt': 1 });

/** Human-friendly, non-sequential order reference. */
export const generateOrderNumber = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0');
  return `ABJ-${stamp}-${noise}`;
};

export default mongoose.model('Order', orderSchema);
