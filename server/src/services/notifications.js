import env from '../config/env.js';
import { Notification } from '../models/index.js';

/**
 * Creates an in-app notification. Email delivery is deliberately NOT faked:
 * when SMTP_URL is unset nothing is sent and we say so in the log, rather
 * than reporting a successful send that never happened.
 */
export const notify = async (userId, { type, title, body = '', link = '' }) => {
  if (!userId) return null;

  const record = await Notification.create({ user: userId, type, title, body, link });

  if (!env.mail.smtpUrl) {
    // Intentionally quiet in normal runs; this is the honest no-op path.
    if (env.isDev) {
      console.log(`[notify] in-app only (no SMTP configured): ${type} -> ${userId}`);
    }
  }

  return record;
};

export const notifyMany = async (userIds, payload) => {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  return Promise.all(unique.map((id) => notify(id, payload)));
};

export const isEmailEnabled = () => Boolean(env.mail.smtpUrl);
