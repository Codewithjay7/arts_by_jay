import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { User, ArtistProfile, Cart, Wishlist } from '../models/index.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from '../services/tokens.js';
import { notify } from '../services/notifications.js';

const requestContext = (req) => ({
  userAgent: req.headers['user-agent'] ?? '',
  ip: req.ip ?? '',
});

/** Builds the session payload the client stores in memory. */
const sessionPayload = async (user) => {
  const payload = { user: user.toPublic(), accessToken: signAccessToken(user) };

  if (user.role === 'artist' || user.role === 'admin') {
    const profile = await ArtistProfile.findOne({ user: user._id }).lean();
    if (profile) {
      payload.artistProfile = {
        id: profile._id.toString(),
        displayName: profile.displayName,
        slug: profile.slug,
        status: profile.status,
        avatarUrl: profile.avatarUrl,
      };
    }
  }

  return payload;
};

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, intent, artistName } = req.body;

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  // The ONLY path to the admin role is matching ADMIN_BOOTSTRAP_EMAIL, which
  // is a server-side environment value. Nothing in the request can set it.
  const isBootstrapAdmin =
    Boolean(env.auth.adminBootstrapEmail) && email === env.auth.adminBootstrapEmail;

  const role = isBootstrapAdmin ? 'admin' : intent === 'artist' ? 'artist' : 'customer';

  const user = new User({ name, email, role });
  await user.setPassword(password);
  user.lastLoginAt = new Date();
  await user.save();

  await Promise.all([
    Cart.create({ user: user._id, items: [] }),
    Wishlist.create({ user: user._id, artworks: [] }),
  ]);

  if (role === 'artist') {
    // Artists start as `pending`: they can set up their profile and drafts,
    // but cannot publish until an admin approves the application.
    await ArtistProfile.create({
      user: user._id,
      displayName: artistName?.trim() || name,
      status: 'pending',
    });

    await notify(user._id, {
      type: 'account_notice',
      title: 'Artist application received',
      body: 'Complete your profile while our curators review your application.',
      link: '/artist/storefront',
    });
  }

  const { raw, expiresAt } = await issueRefreshToken(user, requestContext(req));
  setRefreshCookie(res, raw, expiresAt);

  res.status(201).json(await sessionPayload(user));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // `passwordHash` is `select: false`, so it must be asked for explicitly.
  const user = await User.findOne({ email }).select('+passwordHash');

  // Same message and same work either way, so the response cannot be used to
  // discover which emails have accounts.
  const ok = user ? await user.verifyPassword(password) : false;
  if (!user || !ok) {
    throw ApiError.unauthorized('That email and password combination is not correct.');
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      user.suspendedReason
        ? `This account is suspended: ${user.suspendedReason}`
        : 'This account has been suspended. Please contact support.',
    );
  }

  user.lastLoginAt = new Date();
  await user.save();

  const { raw, expiresAt } = await issueRefreshToken(user, requestContext(req));
  setRefreshCookie(res, raw, expiresAt);

  res.json(await sessionPayload(user));
});

/** Exchanges the httpOnly refresh cookie for a new access token. */
export const refresh = asyncHandler(async (req, res) => {
  const raw = readRefreshCookie(req);
  const record = await findValidRefreshToken(raw);

  if (!record) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('Your session has expired. Please sign in again.');
  }

  const user = await User.findById(record.user);
  if (!user || !user.isActive) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('Your session is no longer valid.');
  }

  const rotated = await rotateRefreshToken(record, user, requestContext(req));
  setRefreshCookie(res, rotated.raw, rotated.expiresAt);

  res.json(await sessionPayload(user));
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(readRefreshCookie(req));
  clearRefreshCookie(res);
  res.json({ ok: true });
});

export const me = asyncHandler(async (req, res) => {
  res.json(await sessionPayload(req.user));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.verifyPassword(currentPassword))) {
    throw ApiError.badRequest('Your current password is not correct.');
  }

  // Bumps tokenVersion, which invalidates every previously issued access token.
  await user.setPassword(newPassword);
  await user.save();

  await revokeRefreshToken(readRefreshCookie(req));
  const { raw, expiresAt } = await issueRefreshToken(user, requestContext(req));
  setRefreshCookie(res, raw, expiresAt);

  res.json({ ok: true, ...(await sessionPayload(user)) });
});
