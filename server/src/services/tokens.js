import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import RefreshToken, { hashToken } from '../models/RefreshToken.js';

const REFRESH_COOKIE = 'abj_refresh';

/** Converts a `15m` / `30d` style TTL into milliseconds. */
const ttlToMs = (ttl) => {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return value * unit;
};

export const signAccessToken = (user) =>
  jwt.sign(
    { sub: user._id.toString(), role: user.role, tv: user.tokenVersion },
    env.auth.accessSecret,
    { expiresIn: env.auth.accessTtl, issuer: 'arts-by-jay' },
  );

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.auth.accessSecret, { issuer: 'arts-by-jay' });

/**
 * Issues an opaque refresh token. Only its hash is persisted, and the raw
 * value is returned once so it can be placed in an httpOnly cookie.
 */
export const issueRefreshToken = async (user, { userAgent = '', ip = '' } = {}) => {
  const raw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + ttlToMs(env.auth.refreshTtl));

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(raw),
    expiresAt,
    userAgent: String(userAgent).slice(0, 300),
    ip: String(ip).slice(0, 64),
  });

  return { raw, expiresAt };
};

export const findValidRefreshToken = async (raw) => {
  if (!raw) return null;
  const record = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;
  return record;
};

/** Rotates a refresh token: the old one is revoked as the new one is issued. */
export const rotateRefreshToken = async (record, user, context) => {
  record.revokedAt = new Date();
  await record.save();
  return issueRefreshToken(user, context);
};

export const revokeRefreshToken = async (raw) => {
  if (!raw) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(raw), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
};

export const revokeAllForUser = async (userId) => {
  await RefreshToken.updateOne({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
};

export const setRefreshCookie = (res, raw, expiresAt) => {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'strict' : 'lax',
    domain: env.auth.cookieDomain,
    expires: expiresAt,
    path: '/api/auth',
  });
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'strict' : 'lax',
    domain: env.auth.cookieDomain,
    path: '/api/auth',
  });
};

export const readRefreshCookie = (req) => req.cookies?.[REFRESH_COOKIE] ?? null;

export { REFRESH_COOKIE };
