import client, { unwrap, supabaseError } from '../supabase';

/**
 * Orders, reviews and notifications.
 *
 * Reads lean on RLS rather than filtering by user: the policies on `orders`
 * and `order_items` already restrict a customer to their own orders and an
 * artist to their own line items, even inside an order shared with other
 * artists. Adding a `.eq('customer_id', me)` here would be redundant and
 * would imply the filter is what protects the data.
 *
 * Writes that involve money — creating an order, verifying a payment,
 * refunds, settlements — are NOT here. They go through Edge Functions,
 * because the database revokes those functions from browser roles entirely.
 */

const ORDER_LIST_COLUMNS = `
  id, order_number, status, total_minor, subtotal_minor, shipping_total_minor,
  currency, created_at, paid_at,
  items:order_items ( quantity, image_url )
`;

const ORDER_DETAIL_COLUMNS = `
  id, order_number, status, created_at, paid_at, cancelled_at, cancel_reason,
  currency, subtotal_minor, shipping_total_minor, discount_minor, total_minor,
  shipping_address, billing_address, shipping_method, customer_note,
  items:order_items (
    id, artwork_id, title, slug, image_url, type, medium,
    quantity, unit_price_minor, line_total_minor, shipping_minor,
    commission_rate_percent, commission_basis_minor, commission_minor,
    artist_earnings_minor,
    fulfilment_status, tracking_carrier, tracking_number, tracking_url,
    shipped_at, delivered_at,
    delivery_confirmed_at, return_window_ends_at,
    settlement_status, became_eligible_at, settlement_hold_reason,
    refunded_minor, dispute_open
  )
`;

const toOrderListItem = (row) => ({
  id: row.id,
  orderNumber: row.order_number,
  status: row.status,
  totalMinor: row.total_minor,
  currency: row.currency,
  itemCount: (row.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
  createdAt: row.created_at,
  paidAt: row.paid_at,
  thumbnails: (row.items ?? []).map((item) => item.image_url).filter(Boolean).slice(0, 4),
});

const toOrderItem = (item) => ({
  id: item.id,
  artworkId: item.artwork_id,
  title: item.title,
  slug: item.slug,
  imageUrl: item.image_url,
  type: item.type,
  medium: item.medium,
  quantity: item.quantity,
  unitPriceMinor: item.unit_price_minor,
  lineTotalMinor: item.line_total_minor,
  shippingMinor: item.shipping_minor,
  // The frozen commission snapshot, shown so an artist can audit their own
  // earnings against what was agreed at the time of sale.
  commissionRatePercent: item.commission_rate_percent,
  commissionBasisMinor: item.commission_basis_minor,
  commissionMinor: item.commission_minor,
  earningsMinor: item.artist_earnings_minor,
  fulfilmentStatus: item.fulfilment_status,
  trackingCarrier: item.tracking_carrier,
  trackingNumber: item.tracking_number,
  trackingUrl: item.tracking_url,
  shippedAt: item.shipped_at,
  deliveredAt: item.delivered_at,
  deliveryConfirmedAt: item.delivery_confirmed_at,
  returnWindowEndsAt: item.return_window_ends_at,
  settlementStatus: item.settlement_status,
  becameEligibleAt: item.became_eligible_at,
  settlementHoldReason: item.settlement_hold_reason,
  refundedMinor: item.refunded_minor,
  disputeOpen: item.dispute_open,
});

export const listMyOrders = async ({ page = 1, limit = 10, status } = {}) => {
  const db = client();
  const from = (page - 1) * limit;

  let query = db.from('orders').select(ORDER_LIST_COLUMNS, { count: 'exact' });
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load your orders');

  const total = count ?? 0;

  return {
    items: (data ?? []).map(toOrderListItem),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const getMyOrder = async (orderNumber) => {
  const db = client();

  const row = unwrap(
    await db.from('orders').select(ORDER_DETAIL_COLUMNS).eq('order_number', orderNumber).maybeSingle(),
    'Could not load that order',
  );

  if (!row) {
    const notFound = new Error('That order was not found.');
    notFound.status = 404;
    throw notFound;
  }

  /**
   * Which pieces the buyer may review: delivered, and not already reviewed.
   * The database enforces the same rule on insert, so this only decides
   * whether to show the button.
   */
  const deliveredArtworkIds = (row.items ?? [])
    .filter((item) => item.fulfilment_status === 'delivered')
    .map((item) => item.artwork_id);

  let reviewable = [];
  if (deliveredArtworkIds.length) {
    const existing = unwrap(
      await db.from('reviews').select('artwork_id').in('artwork_id', deliveredArtworkIds),
    );
    const reviewed = new Set((existing ?? []).map((review) => review.artwork_id));
    reviewable = deliveredArtworkIds.filter((id) => !reviewed.has(id));
  }

  return {
    order: {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      createdAt: row.created_at,
      paidAt: row.paid_at,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason,
      currency: row.currency,
      subtotalMinor: row.subtotal_minor,
      shippingTotalMinor: row.shipping_total_minor,
      discountMinor: row.discount_minor,
      totalMinor: row.total_minor,
      shippingAddress: row.shipping_address,
      billingAddress: row.billing_address,
      shippingMethod: row.shipping_method,
      customerNote: row.customer_note,
      // Supabase has no equivalent of the Express history array; the audit
      // log carries that and is admin-only, so the UI shows status instead.
      history: [],
      items: (row.items ?? []).map((item) => ({
        ...toOrderItem(item),
        canReview: reviewable.includes(item.artwork_id),
      })),
    },
  };
};

/* ──────────────────────────── Artist orders ──────────────────────────── */

/**
 * The artist's own order lines.
 *
 * Queried from `order_items` rather than `orders`, because the RLS policy on
 * order_items restricts an artist to their OWN lines. Going through orders
 * would return the whole order and rely on filtering afterwards.
 */
export const listArtistOrders = async ({ page = 1, limit = 15, fulfilmentStatus } = {}) => {
  const db = client();
  const from = (page - 1) * limit;

  let query = db.from('order_items').select(
    `
      id, title, image_url, quantity, unit_price_minor, line_total_minor,
      commission_rate_percent, commission_minor, artist_earnings_minor,
      fulfilment_status, tracking_carrier, tracking_number,
      delivery_confirmed_at, return_window_ends_at,
      settlement_status, settlement_hold_reason, refunded_minor, dispute_open,
      created_at,
      order:orders!inner (
        id, order_number, status, created_at, paid_at, currency, shipping_address
      )
    `,
    { count: 'exact' },
  );

  if (fulfilmentStatus) query = query.eq('fulfilment_status', fulfilmentStatus);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load your orders');

  // Group the artist's lines back under their orders for display.
  const byOrder = new Map();

  (data ?? []).forEach((item) => {
    if (!item.order) return;
    const key = item.order.id;

    if (!byOrder.has(key)) {
      const address = item.order.shipping_address ?? {};
      byOrder.set(key, {
        id: item.order.id,
        orderNumber: item.order.order_number,
        status: item.order.status,
        createdAt: item.order.created_at,
        paidAt: item.order.paid_at,
        currency: item.order.currency,
        shipTo: {
          fullName: address.full_name,
          city: address.city,
          state: address.state,
          postalCode: address.postal_code,
          country: address.country,
        },
        myTotalMinor: 0,
        myEarningsMinor: 0,
        items: [],
      });
    }

    const entry = byOrder.get(key);
    entry.myTotalMinor += item.line_total_minor;
    entry.myEarningsMinor += item.artist_earnings_minor;
    entry.items.push({
      id: item.id,
      title: item.title,
      imageUrl: item.image_url,
      quantity: item.quantity,
      unitPriceMinor: item.unit_price_minor,
      lineTotalMinor: item.line_total_minor,
      commissionRatePercent: item.commission_rate_percent,
      commissionMinor: item.commission_minor,
      earningsMinor: item.artist_earnings_minor,
      fulfilmentStatus: item.fulfilment_status,
      trackingCarrier: item.tracking_carrier,
      trackingNumber: item.tracking_number,
      settlementStatus: item.settlement_status,
      settlementHoldReason: item.settlement_hold_reason,
      deliveryConfirmedAt: item.delivery_confirmed_at,
      returnWindowEndsAt: item.return_window_ends_at,
      // Mirrors the transitions the database trigger will actually accept.
      allowedNext: ALLOWED_TRANSITIONS[item.fulfilment_status] ?? [],
    });
  });

  const total = count ?? 0;

  return {
    items: [...byOrder.values()],
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

/** Must match order_items_guard() in migration 0003. */
export const ALLOWED_TRANSITIONS = {
  awaiting: ['preparing', 'shipped'],
  preparing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Moves one of the artist's own line items forward.
 *
 * The RLS policy restricts this to their own lines and the guard trigger
 * rejects any transition outside ALLOWED_TRANSITIONS, as well as any attempt
 * to touch settlement or delivery confirmation. So this is a plain update and
 * the database refuses anything improper.
 */
export const updateArtistOrderItem = async (itemId, { fulfilmentStatus, trackingCarrier, trackingNumber }) => {
  const db = client();

  const payload = {};
  if (fulfilmentStatus) payload.fulfilment_status = fulfilmentStatus;
  if (trackingCarrier !== undefined) payload.tracking_carrier = trackingCarrier;
  if (trackingNumber !== undefined) payload.tracking_number = trackingNumber;
  if (fulfilmentStatus === 'shipped') payload.shipped_at = new Date().toISOString();
  if (fulfilmentStatus === 'delivered') payload.delivered_at = new Date().toISOString();

  const { data, error } = await db
    .from('order_items')
    .update(payload)
    .eq('id', itemId)
    .select('id, fulfilment_status, tracking_carrier, tracking_number')
    .single();

  if (error) throw new Error(supabaseError(error, 'That order could not be updated.'));

  return {
    item: {
      id: data.id,
      fulfilmentStatus: data.fulfilment_status,
      trackingCarrier: data.tracking_carrier,
      trackingNumber: data.tracking_number,
      allowedNext: ALLOWED_TRANSITIONS[data.fulfilment_status] ?? [],
    },
  };
};

/* ──────────────────────────── Reviews ──────────────────────────── */

export const createReview = async ({ artworkId, orderId, rating, title, body }) => {
  const db = client();
  const { data: session } = await db.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error('Please sign in to continue.');

  const { data, error } = await db
    .from('reviews')
    .insert({
      artwork_id: artworkId,
      author_id: userId,
      order_id: orderId,
      rating,
      title: title ?? '',
      body: body ?? '',
    })
    .select('id, rating, title, body, created_at')
    .single();

  if (error) {
    // The insert policy requires a delivered order containing the piece, so
    // a policy violation here means exactly one thing.
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      throw new Error('You can review a piece once your order for it has been delivered.');
    }
    if (error.code === '23505') {
      throw new Error('You have already reviewed this piece.');
    }
    throw new Error(supabaseError(error, 'Your review could not be saved.'));
  }

  return { review: { id: data.id, rating: data.rating, title: data.title, body: data.body, createdAt: data.created_at } };
};

export const listMyReviews = async () => {
  const db = client();

  const rows = unwrap(
    await db
      .from('reviews')
      .select('id, rating, title, body, created_at, is_hidden, artwork:artworks ( id, title, slug, images )')
      .order('created_at', { ascending: false }),
    'Could not load your reviews',
  );

  return {
    items: (rows ?? []).map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      isHidden: row.is_hidden,
      artwork: row.artwork
        ? {
            id: row.artwork.id,
            title: row.artwork.title,
            slug: row.artwork.slug,
            image: row.artwork.images?.[0]?.thumbUrl || row.artwork.images?.[0]?.url || '',
          }
        : null,
    })),
  };
};

export const deleteReview = async (id) => {
  const db = client();
  unwrap(await db.from('reviews').delete().eq('id', id), 'That review could not be removed');
  return { ok: true };
};

/* ──────────────────────── Notifications ──────────────────────── */

export const listNotifications = async ({ page = 1, limit = 20 } = {}) => {
  const db = client();
  const from = (page - 1) * limit;

  const [listResult, unreadResult] = await Promise.all([
    db
      .from('notifications')
      .select('id, type, title, body, link, read_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1),
    db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);

  unwrap(listResult, 'Could not load your notifications');

  const total = listResult.count ?? 0;

  return {
    items: (listResult.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unread: unreadResult.count ?? 0,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const markNotificationsRead = async (ids) => {
  const db = client();

  let query = db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (ids?.length) query = query.in('id', ids);

  const { error } = await query;
  if (error) throw new Error(supabaseError(error));

  const { count } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  return { unread: count ?? 0 };
};

/** Counts for the account menu badges. */
export const getAccountSummary = async () => {
  const db = client();

  const [orders, active, wishlist, unread] = await Promise.all([
    db.from('orders').select('id', { count: 'exact', head: true }),
    db.from('orders').select('id', { count: 'exact', head: true }).in('status', ['paid', 'processing', 'shipped']),
    db.from('wishlist_items').select('id', { count: 'exact', head: true }),
    db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);

  return {
    orderCount: orders.count ?? 0,
    activeOrders: active.count ?? 0,
    wishlistCount: wishlist.count ?? 0,
    unreadNotifications: unread.count ?? 0,
  };
};
