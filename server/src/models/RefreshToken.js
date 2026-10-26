import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * Refresh tokens are stored as SHA-256 hashes so a leaked database cannot be
 * replayed as a live session. Expired rows are removed by a TTL index.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export default mongoose.model('RefreshToken', refreshTokenSchema);
