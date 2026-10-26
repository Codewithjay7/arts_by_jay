import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { splitCommission } from '../utils/money.js';

/**
 * Re-prices a cart from the database every single time.
 *
 * The client never supplies prices or totals. Every amount here comes from the
 * current Artwork document, and any item whose listing changed since it was
 * added is reported back as an `issue` so the customer is told rather than
 * silently charged a different amount.
 */
export const priceCart = (cart, { shippingMethod = 'standard' } = {}) => {
  const lines = [];
  const issues = [];

  cart.items.forEach((item) => {
    const artwork = item.artwork;

    if (!artwork) {
      issues.push({ kind: 'removed', message: 'An item in your cart is no longer available.' });
      return;
    }

    const label = artwork.title;

    if (artwork.status !== 'published') {
      issues.push({ artworkId: artwork._id.toString(), kind: 'unavailable', message: `"${label}" is no longer on sale.` });
      return;
    }

    if (artwork.type === 'commission') {
      issues.push({
        artworkId: artwork._id.toString(),
        kind: 'commission_only',
        message: `"${label}" is a commission and is arranged with the artist rather than bought directly.`,
      });
      return;
    }

    const digital = Boolean(artwork.shipping?.isDigitalDelivery);
    let quantity = item.quantity;

    if (!digital && !artwork.allowBackorder) {
      if (artwork.stock <= 0) {
        issues.push({ artworkId: artwork._id.toString(), kind: 'sold_out', message: `"${label}" has sold out.` });
        return;
      }
      if (quantity > artwork.stock) {
        quantity = artwork.stock;
        issues.push({
          artworkId: artwork._id.toString(),
          kind: 'quantity_reduced',
          message: `Only ${artwork.stock} of "${label}" ${artwork.stock === 1 ? 'is' : 'are'} available, so the quantity was reduced.`,
        });
      }
    }

    if (item.priceAtAddMinor !== artwork.priceMinor) {
      issues.push({
        artworkId: artwork._id.toString(),
        kind: 'price_changed',
        message: `The price of "${label}" changed since you added it.`,
        fromMinor: item.priceAtAddMinor,
        toMinor: artwork.priceMinor,
      });
    }

    const unitPriceMinor = artwork.priceMinor;
    const lineTotalMinor = unitPriceMinor * quantity;
    // Shipping is charged once per listing, not per unit.
    const shippingMinor = digital ? 0 : (artwork.shipping?.flatRateMinor ?? 0);

    /**
     * Commission is taken on the artwork line total only — never on shipping,
     * which belongs to the artist's dispatch cost. The rate and the basis are
     * both carried forward so the order can snapshot them.
     */
    const commissionRatePercent = env.payments.commissionPercent;
    const commissionBasisMinor = lineTotalMinor;
    const { commissionMinor, earningsMinor } = splitCommission(commissionBasisMinor, commissionRatePercent);

    lines.push({
      artwork,
      quantity,
      unitPriceMinor,
      lineTotalMinor,
      shippingMinor,
      commissionRatePercent,
      commissionBasisMinor,
      commissionMinor,
      earningsMinor,
      isDigital: digital,
    });
  });

  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  let shippingTotalMinor = lines.reduce((sum, line) => sum + line.shippingMinor, 0);

  // Express shipping is a flat uplift on the physical portion of the order.
  if (shippingMethod === 'express' && lines.some((line) => !line.isDigital)) {
    shippingTotalMinor += 49900;
  }

  const totalMinor = subtotalMinor + shippingTotalMinor;
  const currency = lines[0]?.artwork.currency ?? env.payments.currency;

  // Guard against a mixed-currency cart silently summing into one total.
  const currencies = new Set(lines.map((line) => line.artwork.currency));
  if (currencies.size > 1) {
    throw ApiError.badRequest('Your cart mixes currencies. Please check out those items separately.');
  }

  return {
    lines,
    issues,
    subtotalMinor,
    shippingTotalMinor,
    discountMinor: 0,
    totalMinor,
    currency,
    shippingMethod,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
};

export const SHIPPING_METHODS = [
  {
    key: 'standard',
    label: 'Standard delivery',
    description: 'Insured courier, 5 to 9 working days after the studio dispatches.',
    upliftMinor: 0,
  },
  {
    key: 'express',
    label: 'Express delivery',
    description: 'Priority insured courier, 2 to 4 working days.',
    upliftMinor: 49900,
  },
];
