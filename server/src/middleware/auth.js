import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { User, ArtistProfile } from '../models/index.js';
import { verifyAccessToken } from '../services/tokens.js';

const readBearer = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
};

/**
 * Loads the authenticated user onto `req.user`. The role is always re-read
 * from the database rather than trusted from the token payload, so a revoked
 * or demoted account loses access immediately.
 */
const loadUser = async (req) => {
  const token = readBearer(req);
  if (!token) return null;

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return null;
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) return null;
  // Password change / forced logout invalidates older tokens.
  if (typeof payload.tv === 'number' && payload.tv !== user.tokenVersion) return null;

  return user;
};

/** Populates req.user when a valid token is present, but never rejects. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = await loadUser(req);
  next();
});

/** Rejects the request unless a valid, active user is attached. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const user = await loadUser(req);
  if (!user) throw ApiError.unauthorized('Please sign in to continue.');
  req.user = user;
  next();
});

/**
 * Role gate. Checked server-side against the stored role, so changing
 * browser state or a request body cannot grant a role.
 */
export const requireRole = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized('Please sign in to continue.');
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('Your account does not have access to that area.');
    }
    next();
  });

/**
 * Loads the caller's own artist profile onto `req.artistProfile`. Admins pass
 * through without one. Rejects artists whose application is not approved.
 */
export const requireApprovedArtist = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw ApiError.unauthorized('Please sign in to continue.');

  if (req.user.role === 'admin') {
    req.artistProfile = await ArtistProfile.findOne({ user: req.user._id });
    return next();
  }

  if (req.user.role !== 'artist') {
    throw ApiError.forbidden('Only artist accounts can manage listings.');
  }

  const profile = await ArtistProfile.findOne({ user: req.user._id });
  if (!profile) {
    throw ApiError.forbidden('Create your artist profile before managing listings.');
  }
  if (profile.status !== 'approved') {
    throw ApiError.forbidden(
      profile.status === 'pending'
        ? 'Your artist application is still under review.'
        : 'Your artist account is not currently approved to sell.',
    );
  }

  req.artistProfile = profile;
  return next();
});
