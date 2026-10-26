import mongoose from 'mongoose';

export const COMMISSION_STATUS = [
  'new',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'in_progress',
  'completed',
  'cancelled',
];

export const COMMISSION_KINDS = ['commission', 'enquiry', 'photo_to_art'];

const commissionSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: COMMISSION_KINDS, default: 'commission', index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactPhone: { type: String, default: '', trim: true, maxlength: 32 },

    artist: { type: mongoose.Schema.Types.ObjectId, ref: 'ArtistProfile', default: null, index: true },
    artistUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Set when the enquiry came from a specific listing.
    artwork: { type: mongoose.Schema.Types.ObjectId, ref: 'Artwork', default: null },

    subject: { type: String, default: '', maxlength: 180 },
    message: { type: String, required: true, maxlength: 5000 },

    // Photo-to-Art studio fields.
    styleKey: { type: String, default: '' },
    referenceImages: [
      {
        _id: false,
        url: String,
        publicId: String,
      },
    ],
    // Explicit, recorded consent, required before a private customer photo is
    // stored on the server or passed to any external service.
    photoConsent: { type: Boolean, default: false },

    preferredSize: { type: String, default: '', maxlength: 120 },
    budgetMinor: { type: Number, default: null, min: 0 },
    deadline: { type: Date, default: null },

    status: { type: String, enum: COMMISSION_STATUS, default: 'new', index: true },
    quotedAmountMinor: { type: Number, default: null, min: 0 },
    quoteNote: { type: String, default: '', maxlength: 2000 },

    messages: [
      {
        _id: false,
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        fromRole: String,
        body: { type: String, maxlength: 5000 },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

commissionSchema.index({ artistUser: 1, status: 1, createdAt: -1 });

export const generateCommissionReference = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  return `CMS-${stamp}-${noise}`;
};

export default mongoose.model('CommissionRequest', commissionSchema);
