/**
 * Formatting helpers. Every monetary value crossing the API is an integer in
 * minor units (paise for INR), so formatting is the only place it becomes a
 * decimal — arithmetic never is.
 */

const currencyFormatters = new Map();

const formatterFor = (currency) => {
  if (!currencyFormatters.has(currency)) {
    currencyFormatters.set(
      currency,
      new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }),
    );
  }
  return currencyFormatters.get(currency);
};

export const formatMoney = (minor, currency = 'INR') => {
  if (minor == null || Number.isNaN(Number(minor))) return '—';
  return formatterFor(currency).format(Number(minor) / 100);
};

/** Keeps the paise when they matter, drops them when they do not. */
export const formatMoneyPrecise = (minor, currency = 'INR') => {
  if (minor == null) return '—';
  const major = Number(minor) / 100;
  const hasFraction = Math.abs(major % 1) > 0.001;

  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(major);
};

export const minorToMajor = (minor) => (minor == null ? '' : Number(minor) / 100);

export const formatDate = (value, options = {}) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(new Date(value));
};

export const formatDateTime = (value) =>
  formatDate(value, { hour: '2-digit', minute: '2-digit' });

export const formatRelative = (value) => {
  if (!value) return '—';

  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
};

/** "110 × 150 × 4 cm", skipping any missing axis. */
export const formatDimensions = (dimensions) => {
  if (!dimensions) return '';

  const parts = [dimensions.width, dimensions.height, dimensions.depth].filter(
    (value) => value != null && Number(value) > 0,
  );
  if (!parts.length) return '';

  return `${parts.join(' × ')} ${dimensions.unit ?? 'cm'}`;
};

const STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Being prepared',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  awaiting: 'Awaiting dispatch',
  preparing: 'Being prepared',
  draft: 'Draft',
  pending: 'In review',
  published: 'Live',
  rejected: 'Not approved',
  unpublished: 'Unpublished',
  archived: 'Archived',
  approved: 'Approved',
  suspended: 'Suspended',
  new: 'New',
  in_review: 'In review',
  quoted: 'Quoted',
  accepted: 'Accepted',
  declined: 'Declined',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const statusLabel = (status) => STATUS_LABELS[status] ?? status?.replace(/_/g, ' ') ?? '';

/** Maps a status onto a badge tone, so colour and wording stay in step. */
export const statusTone = (status) => {
  if (['paid', 'delivered', 'published', 'approved', 'completed', 'accepted'].includes(status)) return 'positive';
  if (['pending_payment', 'pending', 'awaiting', 'new', 'in_review', 'quoted', 'draft'].includes(status)) return 'neutral';
  if (['processing', 'preparing', 'shipped', 'in_progress'].includes(status)) return 'info';
  if (['cancelled', 'rejected', 'refunded', 'suspended', 'declined', 'archived', 'unpublished'].includes(status)) return 'negative';
  return 'neutral';
};

export const ARTWORK_TYPE_LABELS = {
  original: 'Original',
  print: 'Print',
  digital: 'Digital',
  commission: 'Commission',
};

export const pluralise = (count, singular, plural) =>
  `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

export const truncate = (text, limit = 140) => {
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
};
