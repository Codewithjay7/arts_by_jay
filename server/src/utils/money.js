/**
 * All monetary amounts are stored and transmitted as integer minor units
 * (paise for INR, cents for USD) so arithmetic never hits float rounding.
 */
export const toMinor = (major) => Math.round(Number(major) * 100);

export const toMajor = (minor) => Math.round(Number(minor)) / 100;

export const sumMinor = (values) => values.reduce((total, value) => total + Math.round(Number(value) || 0), 0);

/** Splits an amount into the platform's commission and the artist's earnings. */
export const splitCommission = (amountMinor, commissionPercent) => {
  const commission = Math.round((amountMinor * commissionPercent) / 100);
  return { commissionMinor: commission, earningsMinor: amountMinor - commission };
};
