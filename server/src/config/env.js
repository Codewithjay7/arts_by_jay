import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (value, fallback = '') => (value === undefined || value === '' ? fallback : String(value).trim());

const nodeEnv = str(process.env.NODE_ENV, 'development');
const isProd = nodeEnv === 'production';

const env = {
  nodeEnv,
  isProd,
  isDev: !isProd,
  port: int(process.env.PORT, 5000),
  clientOrigin: str(process.env.CLIENT_ORIGIN, 'http://localhost:5173'),
  publicApiUrl: str(process.env.PUBLIC_API_URL, `http://localhost:${int(process.env.PORT, 5000)}`),

  db: {
    uri: str(process.env.MONGODB_URI, 'mongodb://127.0.0.1:27017/arts_by_jay'),
    useMemory: bool(process.env.USE_MEMORY_DB, false),
  },

  auth: {
    accessSecret: str(process.env.JWT_ACCESS_SECRET),
    refreshSecret: str(process.env.JWT_REFRESH_SECRET),
    accessTtl: str(process.env.JWT_ACCESS_TTL, '15m'),
    refreshTtl: str(process.env.JWT_REFRESH_TTL, '30d'),
    cookieDomain: str(process.env.COOKIE_DOMAIN) || undefined,
    adminBootstrapEmail: str(process.env.ADMIN_BOOTSTRAP_EMAIL).toLowerCase(),
  },

  payments: {
    provider: str(process.env.PAYMENT_PROVIDER, 'none').toLowerCase(),
    currency: str(process.env.CURRENCY, 'INR').toUpperCase(),
    commissionPercent: int(process.env.PLATFORM_COMMISSION_PERCENT, 10),
    // Days after confirmed delivery before an artist's share is payable.
    returnWindowDays: int(process.env.RETURN_WINDOW_DAYS, 7),
    razorpay: {
      keyId: str(process.env.RAZORPAY_KEY_ID),
      keySecret: str(process.env.RAZORPAY_KEY_SECRET),
      webhookSecret: str(process.env.RAZORPAY_WEBHOOK_SECRET),
      // Only ever set to true once Razorpay has APPROVED Route on the account.
      // Verify with `npm run test:razorpay` rather than assuming.
      routeEnabled: bool(process.env.RAZORPAY_ROUTE_ENABLED, false),
    },
    stripe: {
      secretKey: str(process.env.STRIPE_SECRET_KEY),
      publishableKey: str(process.env.STRIPE_PUBLISHABLE_KEY),
      webhookSecret: str(process.env.STRIPE_WEBHOOK_SECRET),
    },
  },

  storage: {
    driver: str(process.env.STORAGE_DRIVER, 'local').toLowerCase(),
    maxUploadMb: int(process.env.MAX_UPLOAD_MB, 8),
    cloudinary: {
      cloudName: str(process.env.CLOUDINARY_CLOUD_NAME),
      apiKey: str(process.env.CLOUDINARY_API_KEY),
      apiSecret: str(process.env.CLOUDINARY_API_SECRET),
    },
  },

  ai: {
    provider: str(process.env.AI_IMAGE_PROVIDER).toLowerCase(),
    apiKey: str(process.env.AI_IMAGE_API_KEY),
  },

  mail: {
    smtpUrl: str(process.env.SMTP_URL),
    from: str(process.env.MAIL_FROM),
  },
};

/**
 * Secrets must be real in production. In development we derive a stable
 * throwaway secret so the app boots, but we say so loudly — sessions will
 * not survive a secret change.
 */
const DEV_FALLBACK_SECRET = 'arts-by-jay-insecure-development-secret';

export const configWarnings = [];

if (!env.auth.accessSecret || env.auth.accessSecret.startsWith('replace_me')) {
  if (env.isProd) throw new Error('JWT_ACCESS_SECRET must be set to a strong random value in production.');
  env.auth.accessSecret = `${DEV_FALLBACK_SECRET}-access`;
  configWarnings.push('JWT_ACCESS_SECRET is not set — using an insecure development fallback.');
}

if (!env.auth.refreshSecret || env.auth.refreshSecret.startsWith('replace_me')) {
  if (env.isProd) throw new Error('JWT_REFRESH_SECRET must be set to a strong random value in production.');
  env.auth.refreshSecret = `${DEV_FALLBACK_SECRET}-refresh`;
  configWarnings.push('JWT_REFRESH_SECRET is not set — using an insecure development fallback.');
}

if (env.auth.accessSecret === env.auth.refreshSecret) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
}

if (env.payments.provider === 'dev' && env.isProd) {
  throw new Error('PAYMENT_PROVIDER=dev is a local simulation and cannot be used in production.');
}

if (env.db.useMemory && env.isProd) {
  throw new Error('USE_MEMORY_DB=true discards all data on restart and cannot be used in production.');
}

if (env.payments.provider === 'none') {
  configWarnings.push('PAYMENT_PROVIDER=none — checkout is disabled until a gateway is configured.');
}

if (env.storage.driver === 'local' && env.isProd) {
  configWarnings.push('STORAGE_DRIVER=local writes uploads to the server disk; use cloudinary in production.');
}

if (!env.ai.provider) {
  configWarnings.push('AI_IMAGE_PROVIDER is not set — the photo studio runs as a local preview only.');
}

if (!env.mail.smtpUrl) {
  configWarnings.push('SMTP_URL is not set — notifications are stored in-app and no email is sent.');
}

export default env;
