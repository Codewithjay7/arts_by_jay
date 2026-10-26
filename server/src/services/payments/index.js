import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import * as razorpay from './razorpay.js';
import * as stripe from './stripe.js';
import * as dev from './dev.js';

const adapters = { razorpay, stripe, dev };

/**
 * Returns the configured gateway adapter, or throws a clear 503. Nothing in
 * the app pretends a payment happened when no gateway is available.
 */
export const getProvider = () => {
  const key = env.payments.provider;

  if (key === 'none') {
    throw ApiError.notConfigured(
      'Online payment is not enabled on this server yet. Set PAYMENT_PROVIDER in the server environment.',
      { code: 'PAYMENTS_DISABLED' },
    );
  }

  const adapter = adapters[key];
  if (!adapter) {
    throw ApiError.notConfigured(`Unknown PAYMENT_PROVIDER "${key}".`, { code: 'PAYMENTS_MISCONFIGURED' });
  }
  if (!adapter.isConfigured()) {
    throw ApiError.notConfigured(
      `${key} is selected as the payment provider but its credentials are missing.`,
      { code: 'PAYMENTS_MISCONFIGURED' },
    );
  }

  return adapter;
};

export const isPaymentsEnabled = () => {
  try {
    getProvider();
    return true;
  } catch {
    return false;
  }
};

/** Safe-to-publish checkout capability description for the client. */
export const describePaymentCapability = () => {
  const key = env.payments.provider;

  if (key === 'none') {
    return {
      enabled: false,
      provider: 'none',
      currency: env.payments.currency,
      isSimulated: false,
      reason: 'Online payment has not been configured on this server.',
    };
  }

  const adapter = adapters[key];
  if (!adapter || !adapter.isConfigured()) {
    return {
      enabled: false,
      provider: key,
      currency: env.payments.currency,
      isSimulated: false,
      reason: `${key} is selected but its credentials are missing.`,
    };
  }

  return { enabled: true, ...adapter.publicConfig() };
};

export { adapters };
