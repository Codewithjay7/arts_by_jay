import client, { unwrap, supabaseError } from '../supabase';
import { toCard } from './artworks';
import { requireAdmin } from './session';

/**
 * Administration.
 *
 * Every function here is gated by `is_admin()` in RLS, so a non-admin session
 * sees none of the ROWS. The database is the boundary; the route guard is a
 * courtesy.
 *
 * Each read also asserts `requireAdmin()` first, which is not about secrecy —
 * RLS already handles that, and it was verified that nothing leaks. It is
 * because seeing no rows and not being allowed to look produce the same
 * answer: a dashboard reporting 0 users, 0 orders and no revenue. That is
 * indistinguishable from a real platform with no activity, so it is refused
 * instead.
 *
 * What is NOT here: issuing refunds and recording payouts. Those call
 * `apply_refund` and `record_settlement`, which are REVOKEd from browser
 * roles entirely and reachable only through an Edge Function. An admin with a
 * compromised session still cannot move money from the browser.
 */

/* ─────────────────────────── Overview ─────────────────────────── */

export const getOverview = async () => {
  await requireAdmin();
  const db = client();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const PAID = ['paid', 'processing', 'shipped', 'delivered', 'eligible_for_settlement', 'settled'];

  const [users, artists, artworks, orders, paidOrders, recentOrders, settings, queues] =
    await Promise.all([
      db.from('profiles').select('role'),
      db.from('artist_profiles').select('status'),
      db.from('artworks').select('status'),
      db.from('orders').select('status'),
      db.from('orders').select('total_minor, paid_at, items:order_items ( commission_minor )').in('status', PAID),
      db
        .from('orders')
        .select('order_number, status, total_minor, currency, created_at, customer_email')
        .neq('status', 'pending_payment')
        .order('created_at', { ascending: false })
        .limit(8),
      db.from('platform_settings').select('key, value'),
      Promise.all([
        db.from('artworks').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('artist_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('artworks').select('id', { count: 'exact', head: true }).gt('report_count', 0),
        db
          .from('commission_requests')
          .select('id', { count: 'exact', head: true })
          .in('status', ['new', 'in_review']),
      ]),
    ]);

  const tally = (rows, key) =>
    (rows ?? []).reduce(
      (acc, row) => {
        acc[row[key]] = (acc[row[key]] ?? 0) + 1;
        acc.total += 1;
        return acc;
      },
      { total: 0 },
    );

  const settingMap = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
  const paid = paidOrders.data ?? [];

  const grossMinor = paid.reduce((sum, order) => sum + order.total_minor, 0);
  const commissionMinor = paid.reduce(
    (sum, order) => sum + (order.items ?? []).reduce((s, item) => s + item.commission_minor, 0),
    0,
  );
  const recent = paid.filter((order) => order.paid_at && order.paid_at >= since);

  const [pendingArtworks, pendingArtists, reportedArtworks, openEnquiries] = queues;
  const provider = settingMap.get('razorpay_route_enabled') === 'true' ? 'razorpay' : 'razorpay';

  return {
    users: tally(users.data, 'role'),
    artists: tally(artists.data, 'status'),
    artworks: tally(artworks.data, 'status'),
    orders: tally(orders.data, 'status'),
    revenue: {
      grossMinor,
      commissionMinor,
      payableMinor: grossMinor - commissionMinor,
      paidOrderCount: paid.length,
      last30DaysGrossMinor: recent.reduce((sum, order) => sum + order.total_minor, 0),
      last30DaysOrderCount: recent.length,
      currency: 'INR',
      commissionPercent: Number(settingMap.get('commission_percent') ?? 10),
    },
    queues: {
      pendingArtworks: pendingArtworks.count ?? 0,
      pendingArtists: pendingArtists.count ?? 0,
      reportedArtworks: reportedArtworks.count ?? 0,
      openEnquiries: openEnquiries.count ?? 0,
    },
    recentOrders: (recentOrders.data ?? []).map((order) => ({
      orderNumber: order.order_number,
      status: order.status,
      totalMinor: order.total_minor,
      currency: order.currency,
      createdAt: order.created_at,
      customerEmail: order.customer_email,
      isSimulatedPayment: false,
    })),
    integrity: {
      paymentProvider: provider,
      isSimulatedGateway: false,
      // Route being off is the single most important fact on this dashboard,
      // because it means artist payouts are a ledger rather than transfers.
      routeEnabled: settingMap.get('razorpay_route_enabled') === 'true',
      simulatedOrderCount: 0,
    },
  };
};

/* ─────────────────────────── Users ─────────────────────────── */

export const listUsers = async ({ page = 1, limit = 20, q, role, active } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, phone, is_active, suspended_reason, last_login_at, created_at', {
      count: 'exact',
    });

  if (role) query = query.eq('role', role);
  if (active === 'true') query = query.eq('is_active', true);
  if (active === 'false') query = query.eq('is_active', false);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the accounts');

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      name: row.full_name,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatar_url,
      phone: row.phone,
      isActive: row.is_active,
      suspendedReason: row.suspended_reason,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const updateUser = async (id, { role, isActive, suspendedReason }) => {
  const db = client();

  const payload = {};
  if (role !== undefined) payload.role = role;
  if (isActive !== undefined) {
    payload.is_active = isActive;
    payload.suspended_reason = isActive ? '' : (suspendedReason ?? 'Suspended by an administrator.');
  }

  const { data, error } = await db
    .from('profiles')
    .update(payload)
    .eq('id', id)
    .select('id, email, full_name, role, is_active, suspended_reason')
    .single();

  if (error) {
    // The guard trigger raises a readable message when an admin tries to
    // demote or suspend their own account.
    throw new Error(supabaseError(error, 'That account could not be updated.'));
  }

  // Promoting to artist needs a profile to exist; the signup trigger only
  // creates one for self-registered artists.
  if (role === 'artist') {
    const existing = unwrap(await db.from('artist_profiles').select('id').eq('user_id', id).maybeSingle());
    if (!existing) {
      await db
        .from('artist_profiles')
        .insert({ user_id: id, display_name: data.full_name || data.email, status: 'pending' });
    }
  }

  return {
    user: {
      id: data.id,
      name: data.full_name,
      email: data.email,
      role: data.role,
      isActive: data.is_active,
      suspendedReason: data.suspended_reason,
    },
  };
};

/* ─────────────────────── Artist applications ─────────────────────── */

export const listArtistApplications = async ({ page = 1, limit = 20, status } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('artist_profiles')
    .select('*, user:profiles!artist_profiles_user_id_fkey ( id, email, full_name, is_active, created_at )', {
      count: 'exact',
    });

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the applications');

  // Published counts and earnings, keyed by artist_profiles.id. These used to
  // be read from `row.stats`, a MongoDB embedded document with no Postgres
  // column: it read as undefined and every artist showed 0 works and 0
  // earned, so the admin could not tell a busy artist from a dormant one.
  // A failure here must not take down the list, so the stats are optional
  // and the rows fall back to null rather than to a confident zero.
  const statsResult = await db.rpc('admin_artist_stats');
  const statsById = statsResult.error ? null : (statsResult.data ?? {});

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      slug: row.slug,
      status: row.status,
      bio: row.bio,
      location: row.location,
      avatarUrl: row.avatar_url,
      specialities: row.specialities ?? [],
      links: row.links ?? {},
      stats: statsById?.[row.id]
        ? {
            publishedArtworks: Number(statsById[row.id].published_artworks ?? 0),
            totalSales: Number(statsById[row.id].total_sales ?? 0),
            lifetimeEarningsMinor: Number(statsById[row.id].lifetime_earnings_minor ?? 0),
            pendingEarningsMinor: Number(statsById[row.id].pending_earnings_minor ?? 0),
          }
        : null,
      reviewNote: row.review_note,
      createdAt: row.created_at,
      user: row.user
        ? { id: row.user.id, name: row.user.full_name, email: row.user.email, isActive: row.user.is_active }
        : null,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const reviewArtistApplication = async (id, { decision, note }) => {
  const db = client();
  const { data: session } = await db.auth.getSession();

  const row = unwrap(
    await db
      .from('artist_profiles')
      .update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session?.session?.user?.id ?? null,
        review_note: note ?? '',
      })
      .eq('id', id)
      .select('id, status, review_note')
      .single(),
    'That decision could not be recorded',
  );

  // A rejected or suspended artist's live work comes off the storefront.
  if (decision !== 'approved') {
    await db.from('artworks').update({ status: 'unpublished' }).eq('artist_id', id).eq('status', 'published');
  }

  return { profile: { id: row.id, status: row.status, reviewNote: row.review_note } };
};

/* ─────────────────────── Artwork moderation ─────────────────────── */

export const listArtworksForModeration = async ({ page = 1, limit = 12, status, reported, q } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('artworks')
    .select(
      `id, title, slug, description, price_minor, currency, images, type, medium, style,
       orientation, width_cm, height_cm, depth_cm, stock, allow_backorder,
       is_digital_delivery, is_unique, status, is_featured, report_count,
       moderation_note, moderated_at, created_at, updated_at,
       rating_average, rating_count,
       artist:artist_profiles ( id, display_name, slug, status ),
       category:categories ( id, name, slug )`,
      { count: 'exact' },
    );

  if (status) query = query.eq('status', status);
  if (reported === 'true') query = query.gt('report_count', 0);
  if (q) query = query.ilike('title', `%${q}%`);

  const { data, error, count } = await query
    .order('status', { ascending: true })
    .order('updated_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the moderation queue');

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      ...toCard(row),
      status: row.status,
      description: row.description,
      moderation: {
        note: row.moderation_note,
        reportCount: row.report_count,
        reviewedAt: row.moderated_at,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const moderateArtwork = async (id, { decision, note }) => {
  const db = client();
  const { data: session } = await db.auth.getSession();

  const current = unwrap(
    await db.from('artworks').select('is_featured, artist:artist_profiles ( status )').eq('id', id).single(),
  );

  const payload = {
    moderated_at: new Date().toISOString(),
    moderated_by: session?.session?.user?.id ?? null,
    moderation_note: note ?? '',
  };

  if (decision === 'approve') {
    // Publishing an unapproved artist's work would put a seller on the
    // storefront who has not been vetted.
    if (current.artist?.status !== 'approved') {
      throw new Error('Approve the artist account before publishing their work.');
    }
    payload.status = 'published';
    payload.published_at = new Date().toISOString();
    payload.report_count = 0;
  } else if (decision === 'reject') {
    payload.status = 'rejected';
  } else if (decision === 'unpublish') {
    payload.status = 'unpublished';
  } else if (decision === 'feature') {
    payload.is_featured = !current.is_featured;
  }

  const row = unwrap(
    await db.from('artworks').update(payload).eq('id', id).select('id, status, is_featured').single(),
    'That decision could not be recorded',
  );

  return { artwork: { id: row.id, status: row.status, isFeatured: row.is_featured } };
};

/* ─────────────────────────── Categories ─────────────────────────── */

export const createCategory = async ({ name, description, parent, isFeatured, sortOrder }) => {
  const db = client();

  // `slug` is omitted on purpose: the trigger generates a unique one. A
  // client-chosen slug is part of a public URL and invites collisions.
  const row = unwrap(
    await db
      .from('categories')
      .insert({
        name,
        description: description ?? '',
        parent_id: parent || null,
        is_featured: Boolean(isFeatured),
        sort_order: Number(sortOrder) || 0,
      })
      .select('*')
      .single(),
    'That category could not be created',
  );

  return { category: row };
};

export const updateCategory = async (id, input) => {
  const db = client();

  const payload = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.isFeatured !== undefined) payload.is_featured = input.isFeatured;
  if (input.sortOrder !== undefined) payload.sort_order = Number(input.sortOrder) || 0;

  const row = unwrap(
    await db.from('categories').update(payload).eq('id', id).select('*').single(),
    'That category could not be saved',
  );

  return { category: row };
};

export const deleteCategory = async (id) => {
  const db = client();

  const inUse = unwrap(await db.from('artworks').select('id', { count: 'exact', head: true }).eq('category_id', id));
  const { count } = await db.from('artworks').select('id', { count: 'exact', head: true }).eq('category_id', id);

  if ((count ?? 0) > 0) {
    throw new Error(`${count} artwork${count === 1 ? '' : 's'} still use that category.`);
  }

  const children = await db.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id);
  if ((children.count ?? 0) > 0) {
    throw new Error('Remove or re-parent the sub-categories first.');
  }

  const { error } = await db.from('categories').delete().eq('id', id);
  if (error) {
    // ON DELETE RESTRICT on artworks.category_id backs this up even if the
    // checks above were somehow raced.
    throw new Error(supabaseError(error, 'That category could not be deleted.'));
  }

  return { ok: true, inUse };
};

/* ─────────────────────────── Orders ─────────────────────────── */

export const listAllOrders = async ({ page = 1, limit = 20, q, status } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('orders')
    .select('id, order_number, status, customer_email, total_minor, currency, created_at, paid_at, items:order_items ( quantity )', {
      count: 'exact',
    });

  if (status) query = query.eq('status', status);
  if (q) query = query.or(`order_number.ilike.%${q}%,customer_email.ilike.%${q}%`);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the orders');

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      customerEmail: row.customer_email,
      totalMinor: row.total_minor,
      currency: row.currency,
      itemCount: (row.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
      createdAt: row.created_at,
      paidAt: row.paid_at,
      isSimulatedPayment: false,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const getOrderForAdmin = async (orderNumber) => {
  await requireAdmin();
  const db = client();

  const row = unwrap(
    await db
      .from('orders')
      .select(
        `*, items:order_items ( * ),
         payment:payments ( id, provider, provider_order_id, provider_payment_id, status,
                            amount_minor, currency, verified_at, verified_via, refunded_minor )`,
      )
      .eq('order_number', orderNumber)
      .maybeSingle(),
    'Could not load that order',
  );

  if (!row) {
    const notFound = new Error('That order was not found.');
    notFound.status = 404;
    throw notFound;
  }

  return { order: row };
};

/* ─────────────────────────── Reports ─────────────────────────── */

export const getSalesReport = async ({ days = 30 } = {}) => {
  await requireAdmin();
  const db = client();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const PAID = ['paid', 'processing', 'shipped', 'delivered', 'eligible_for_settlement', 'settled'];

  const [orders, items, settings] = await Promise.all([
    db.from('orders').select('total_minor, paid_at').in('status', PAID).gte('paid_at', since),
    db
      .from('order_items')
      .select(
        `line_total_minor, commission_minor, artist_earnings_minor, quantity,
         artist:artist_profiles ( id, display_name, slug ),
         artwork:artworks ( category:categories ( id, name, slug ) ),
         order:orders!inner ( status, paid_at )`,
      )
      .gte('order.paid_at', since),
    db.from('platform_settings').select('key, value'),
  ]);

  const settingMap = new Map((settings.data ?? []).map((row) => [row.key, row.value]));

  // By day.
  const dayMap = new Map();
  (orders.data ?? []).forEach((order) => {
    if (!order.paid_at) return;
    const day = order.paid_at.slice(0, 10);
    const entry = dayMap.get(day) ?? { date: day, grossMinor: 0, orders: 0 };
    entry.grossMinor += order.total_minor;
    entry.orders += 1;
    dayMap.set(day, entry);
  });

  // By artist and by category.
  const artistMap = new Map();
  const categoryMap = new Map();

  (items.data ?? []).forEach((item) => {
    if (!PAID.includes(item.order?.status)) return;

    const artistId = item.artist?.id ?? 'unknown';
    const artist = artistMap.get(artistId) ?? {
      _id: artistId,
      displayName: item.artist?.display_name,
      slug: item.artist?.slug,
      grossMinor: 0,
      commissionMinor: 0,
      earningsMinor: 0,
      units: 0,
    };
    artist.grossMinor += item.line_total_minor;
    artist.commissionMinor += item.commission_minor;
    artist.earningsMinor += item.artist_earnings_minor;
    artist.units += item.quantity;
    artistMap.set(artistId, artist);

    const category = item.artwork?.category;
    const categoryId = category?.id ?? 'uncategorised';
    const cat = categoryMap.get(categoryId) ?? {
      _id: categoryId,
      name: category?.name,
      slug: category?.slug,
      grossMinor: 0,
      units: 0,
    };
    cat.grossMinor += item.line_total_minor;
    cat.units += item.quantity;
    categoryMap.set(categoryId, cat);
  });

  return {
    days,
    currency: 'INR',
    commissionPercent: Number(settingMap.get('commission_percent') ?? 10),
    byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byArtist: [...artistMap.values()].sort((a, b) => b.grossMinor - a.grossMinor).slice(0, 20),
    byCategory: [...categoryMap.values()].sort((a, b) => b.grossMinor - a.grossMinor),
    note:
      settingMap.get('razorpay_route_enabled') === 'true'
        ? ''
        : 'Razorpay Route is not enabled, so artist earnings shown here are an accounting ledger. No payout has been transferred.',
  };
};

/* ─────────────────────────── Settings ─────────────────────────── */

export const getPlatformSettings = async () => {
  await requireAdmin();
  const db = client();

  const rows = unwrap(
    await db.from('platform_settings').select('key, value, description, updated_at'),
    'Could not load the settings',
  );

  const map = new Map((rows ?? []).map((row) => [row.key, row.value]));

  return {
    environment: (import.meta.env ?? {}).MODE ?? 'unknown',
    settings: rows ?? [],
    payments: {
      provider: 'razorpay',
      currency: 'INR',
      commissionPercent: Number(map.get('commission_percent') ?? 10),
      isSimulated: false,
      routeEnabled: map.get('razorpay_route_enabled') === 'true',
    },
    storage: { driver: 'supabase', maxUploadMb: 8 },
    features: {
      aiPhotoStudio: false,
      emailDelivery: false,
      inMemoryDatabase: false,
    },
    returnWindowDays: Number(map.get('return_window_days') ?? 7),
    note:
      'The commission rate and return window are editable and apply to FUTURE orders only — every order item keeps a snapshot of the rate that applied when it was placed. Payment provider keys are Edge Function secrets and are not editable from here.',
  };
};

/**
 * Updates a platform setting.
 *
 * Changing `commission_percent` affects new orders only. The immutability
 * trigger on `order_items` guarantees that, so this cannot retroactively
 * alter what any artist was owed.
 */
export const updatePlatformSetting = async (key, value) => {
  const db = client();

  if (!['commission_percent', 'return_window_days'].includes(key)) {
    throw new Error('That setting is not editable from the dashboard.');
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Enter a valid number.');
  if (key === 'commission_percent' && numeric > 100) throw new Error('A commission cannot exceed 100%.');

  const row = unwrap(
    await db.from('platform_settings').update({ value: String(numeric) }).eq('key', key).select('*').single(),
    'That setting could not be saved',
  );

  return { setting: row };
};

/* ─────────────────────────── Reviews ─────────────────────────── */

export const hideReview = async (id, { isHidden = true, reason = '' } = {}) => {
  const db = client();

  const row = unwrap(
    await db
      .from('reviews')
      .update({ is_hidden: isHidden, hidden_reason: reason })
      .eq('id', id)
      .select('id, is_hidden')
      .single(),
    'That review could not be updated',
  );

  return { review: { id: row.id, isHidden: row.is_hidden } };
};
