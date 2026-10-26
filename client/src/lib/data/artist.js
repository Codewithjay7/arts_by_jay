import client, { unwrap, supabaseError, uploadImage } from '../supabase';
import { toCard } from './artworks';

/**
 * Artist profile, listings and dashboard.
 *
 * Ownership is enforced in the database, not here. The RLS policy on
 * `artworks` restricts an artist to rows whose `owner_id` is their own id,
 * and the guard trigger refuses any attempt to publish, feature or rewrite
 * sales counters. So these functions read and write plainly, and a mistake in
 * this file cannot become a security hole.
 */

const currentUser = async () => {
  const { data } = await client().auth.getSession();
  return data?.session?.user ?? null;
};

/* ─────────────────────── Public artist directory ─────────────────────── */

const toPublicProfile = (row) => ({
  id: row.id,
  displayName: row.display_name,
  slug: row.slug,
  bio: row.bio,
  statement: row.statement,
  location: row.location,
  avatarUrl: row.avatar_url,
  coverUrl: row.cover_url,
  specialities: row.specialities ?? [],
  links: row.links ?? {},
  acceptsCommissions: row.accepts_commissions,
  commissionNote: row.commission_note,
  isFeatured: row.is_featured,
  publishedArtworks: row.published_artworks ?? 0,
  totalSales: row.total_sales ?? 0,
  joinedAt: row.created_at,
  status: row.status,
  reviewNote: row.review_note,
});

export const listArtists = async ({ page = 1, limit = 12, q, featured } = {}) => {
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    // artist_public_profiles, not artist_profiles: the view adds the derived
    // published_artworks and total_sales. The table has no `stats` column -
    // that was a MongoDB embedded document, and selecting it failed the whole
    // page with "column artist_profiles.stats does not exist".
    .from('artist_public_profiles')
    .select(
      `id, display_name, slug, bio, statement, location, avatar_url, cover_url,
       specialities, links, accepts_commissions, commission_note, is_featured,
       status, created_at, published_artworks, total_sales`,
      { count: 'exact' },
    )
    // RLS already hides unapproved artists from the public, but being explicit
    // keeps the intent obvious to the next reader.
    .eq('status', 'approved');

  if (q) query = query.ilike('display_name', `%${q}%`);
  if (featured) query = query.eq('is_featured', true);

  const { data, error, count } = await query
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the artists');

  const rows = data ?? [];

  // Three preview thumbnails per artist, in one query rather than N.
  let previews = [];
  if (rows.length) {
    previews =
      unwrap(
        await db
          .from('artworks')
          .select('id, artist_id, title, slug, images')
          .in(
            'artist_id',
            rows.map((row) => row.id),
          )
          .eq('status', 'published')
          .order('published_at', { ascending: false, nullsFirst: false }),
      ) ?? [];
  }

  const byArtist = new Map();
  previews.forEach((artwork) => {
    const list = byArtist.get(artwork.artist_id) ?? [];
    if (list.length < 3) {
      list.push({
        id: artwork.id,
        title: artwork.title,
        slug: artwork.slug,
        image: artwork.images?.[0]?.thumbUrl || artwork.images?.[0]?.url || '',
      });
      byArtist.set(artwork.artist_id, list);
    }
  });

  const total = count ?? 0;

  return {
    items: rows.map((row) => ({
      ...toPublicProfile(row),
      preview: byArtist.get(row.id) ?? [],
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const getArtistStorefront = async (slug, { page = 1, limit = 12 } = {}) => {
  const db = client();

  const profile = unwrap(
    await db
      .from('artist_public_profiles')
      .select(
        `id, display_name, slug, bio, statement, location, avatar_url, cover_url,
         specialities, links, accepts_commissions, commission_note, is_featured,
         status, created_at, published_artworks, total_sales`,
      )
      .eq('slug', slug)
      .eq('status', 'approved')
      .maybeSingle(),
    'Could not load that storefront',
  );

  if (!profile) {
    const notFound = new Error('That artist storefront was not found.');
    notFound.status = 404;
    throw notFound;
  }

  const from = (page - 1) * limit;

  const { data, error, count } = await db
    .from('artworks')
    .select(
      `id, title, slug, price_minor, compare_at_price_minor, currency, images,
       type, medium, style, orientation, width_cm, height_cm, depth_cm,
       stock, allow_backorder, is_digital_delivery, is_unique, status,
       is_featured, rating_average, rating_count,
       artist:artist_profiles ( id, display_name, slug ),
       category:categories ( id, name, slug )`,
      { count: 'exact' },
    )
    .eq('artist_id', profile.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load that storefront');

  const total = count ?? 0;

  return {
    artist: toPublicProfile(profile),
    artworks: (data ?? []).map(toCard),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

/* ─────────────────────── The artist's own profile ─────────────────────── */

export const getMyArtistProfile = async () => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const row = unwrap(
    await db
      .from('artist_public_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    'Could not load your profile',
  );

  if (!row) {
    const notFound = new Error('You do not have an artist profile yet.');
    notFound.status = 404;
    throw notFound;
  }

  // Money comes from artist_payout_summary, which aggregates the immutable
  // per-line snapshots in order_items. This used to read `row.stats`, a
  // MongoDB-era document with no Postgres column: it did not error, it just
  // read as undefined, so the dashboard told every artist their lifetime
  // earnings were zero no matter what they had sold. A wrong number shown
  // confidently is worse than a failure, so it is now derived or absent.
  const [commission, payout] = await Promise.all([
    db.from('platform_settings').select('value').eq('key', 'commission_percent').maybeSingle(),
    db.rpc('artist_payout_summary', { p_artist_user_id: user.id }),
  ]);

  const money = payout.data ?? null;

  return {
    profile: {
      ...toPublicProfile(row),
      stats: {
        publishedArtworks: row.published_artworks ?? 0,
        totalSales: row.total_sales ?? 0,
        // null, not 0, when the summary could not be read: the UI can then
        // say so rather than present an invented figure as settled fact.
        lifetimeEarningsMinor: money ? Number(money.earnings_minor ?? 0) : null,
        pendingEarningsMinor: money ? Number(money.pending_minor ?? 0) : null,
      },
    },
    commissionPercent: Number(commission.data?.value ?? 10),
  };
};

export const createMyArtistProfile = async ({ displayName, bio, location }) => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  // `status` is deliberately not sent. The column defaults to 'pending' and
  // the guard trigger refuses to let a non-admin change it, so an artist
  // cannot approve themselves even by posting the field.
  const row = unwrap(
    await db
      .from('artist_profiles')
      .insert({ user_id: user.id, display_name: displayName, bio: bio ?? '', location: location ?? '' })
      .select('*')
      .single(),
    'That application could not be sent',
  );

  // Promote the account to the artist role. The profiles guard allows this
  // only because the caller is changing their own row from customer; the role
  // column itself is still protected against reaching 'admin'.
  await db.from('profiles').update({ role: 'artist' }).eq('id', user.id);

  return { profile: toPublicProfile(row) };
};

export const updateMyArtistProfile = async (input) => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const payload = {};
  if (input.displayName !== undefined) payload.display_name = input.displayName;
  if (input.bio !== undefined) payload.bio = input.bio;
  if (input.statement !== undefined) payload.statement = input.statement;
  if (input.location !== undefined) payload.location = input.location;
  if (input.specialities !== undefined) payload.specialities = input.specialities;
  if (input.acceptsCommissions !== undefined) payload.accepts_commissions = input.acceptsCommissions;
  if (input.commissionNote !== undefined) payload.commission_note = input.commissionNote;
  if (input.links !== undefined) payload.links = input.links;

  const row = unwrap(
    await db.from('artist_profiles').update(payload).eq('user_id', user.id).select('*').single(),
    'Your storefront could not be saved',
  );

  return { profile: toPublicProfile(row) };
};

/** Uploads a portrait or cover into the artist's own storage folder. */
export const uploadArtistImage = async (field, file) => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const stored = await uploadImage('avatars', user.id, file, { prefix: field });

  const column = field === 'cover' ? 'cover_url' : 'avatar_url';
  const row = unwrap(
    await db.from('artist_profiles').update({ [column]: stored.url }).eq('user_id', user.id).select('*').single(),
    'That image could not be saved',
  );

  return { profile: toPublicProfile(row), image: stored };
};

/* ─────────────────────── The artist's own listings ─────────────────────── */

const ARTWORK_FORM_COLUMNS = `
  id, title, slug, description, story, category_id, type, style, medium, year, tags,
  price_minor, compare_at_price_minor, currency, stock, allow_backorder, is_unique,
  width_cm, height_cm, depth_cm, weight_grams, orientation, is_framed, images,
  ships_from, processing_days, shipping_flat_minor, is_digital_delivery,
  status, published_at, moderation_note, is_featured, in_virtual_gallery,
  views, units_sold, rating_average, rating_count, created_at, updated_at,
  artist:artist_profiles ( id, display_name, slug ),
  category:categories ( id, name, slug )
`;

export const listMyArtworks = async ({ page = 1, limit = 15, status, q } = {}) => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const from = (page - 1) * limit;

  let query = db
    .from('artworks')
    .select(ARTWORK_FORM_COLUMNS, { count: 'exact' })
    .eq('owner_id', user.id);

  if (status) query = query.eq('status', status);
  if (q) query = query.ilike('title', `%${q}%`);

  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load your work');

  // Status counts for the filter dropdown. One extra lightweight query.
  const all = unwrap(await db.from('artworks').select('status').eq('owner_id', user.id)) ?? [];
  const statusCounts = all.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      ...toCard(row),
      status: row.status,
      moderationNote: row.moderation_note ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
    statusCounts,
  };
};

export const getMyArtwork = async (id) => {
  const db = client();

  const row = unwrap(
    await db.from('artworks').select(ARTWORK_FORM_COLUMNS).eq('id', id).maybeSingle(),
    'Could not load that piece',
  );

  if (!row) {
    const notFound = new Error('That artwork was not found.');
    notFound.status = 404;
    throw notFound;
  }

  return {
    artwork: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      story: row.story,
      category: row.category_id,
      type: row.type,
      style: row.style,
      medium: row.medium,
      year: row.year,
      tags: row.tags ?? [],
      // Forms work in rupees; storage is paise.
      price: row.price_minor / 100,
      priceMinor: row.price_minor,
      compareAtPrice: row.compare_at_price_minor == null ? null : row.compare_at_price_minor / 100,
      stock: row.stock,
      allowBackorder: row.allow_backorder,
      dimensions: { width: row.width_cm, height: row.height_cm, depth: row.depth_cm, unit: 'cm' },
      weightGrams: row.weight_grams,
      orientation: row.orientation,
      isFramed: row.is_framed,
      images: row.images ?? [],
      shipping: {
        shipsFrom: row.ships_from,
        processingDays: row.processing_days,
        flatRate: (row.shipping_flat_minor ?? 0) / 100,
        isDigitalDelivery: row.is_digital_delivery,
      },
      status: row.status,
      inVirtualGallery: row.in_virtual_gallery,
      moderationNote: row.moderation_note,
    },
  };
};

/** Maps the form shape onto database columns. Shared by create and update. */
const toArtworkRow = (input) => {
  const row = {};

  if (input.title !== undefined) row.title = input.title;
  if (input.description !== undefined) row.description = input.description;
  if (input.story !== undefined) row.story = input.story;
  if (input.category !== undefined) row.category_id = input.category;
  if (input.type !== undefined) row.type = input.type;
  if (input.style !== undefined) row.style = input.style;
  if (input.medium !== undefined) row.medium = input.medium;
  if (input.year !== undefined) row.year = input.year ? Number(input.year) : null;
  if (input.tags !== undefined) row.tags = input.tags;
  if (input.price !== undefined) row.price_minor = Math.round(Number(input.price) * 100);
  if (input.compareAtPrice !== undefined) {
    row.compare_at_price_minor =
      input.compareAtPrice == null || input.compareAtPrice === ''
        ? null
        : Math.round(Number(input.compareAtPrice) * 100);
  }
  if (input.stock !== undefined) row.stock = Number(input.stock) || 0;
  if (input.allowBackorder !== undefined) row.allow_backorder = input.allowBackorder;
  if (input.orientation !== undefined) row.orientation = input.orientation;
  if (input.isFramed !== undefined) row.is_framed = input.isFramed;
  if (input.weightGrams !== undefined) row.weight_grams = input.weightGrams || null;
  if (input.inVirtualGallery !== undefined) row.in_virtual_gallery = input.inVirtualGallery;
  if (input.images !== undefined) row.images = input.images;

  if (input.dimensions) {
    row.width_cm = input.dimensions.width === '' ? null : input.dimensions.width;
    row.height_cm = input.dimensions.height === '' ? null : input.dimensions.height;
    row.depth_cm = input.dimensions.depth === '' ? null : input.dimensions.depth;
  }

  if (input.shipping) {
    if (input.shipping.shipsFrom !== undefined) row.ships_from = input.shipping.shipsFrom;
    if (input.shipping.processingDays !== undefined) {
      row.processing_days = Number(input.shipping.processingDays) || 0;
    }
    if (input.shipping.flatRate !== undefined) {
      row.shipping_flat_minor = Math.round(Number(input.shipping.flatRate) * 100);
    }
    if (input.shipping.isDigitalDelivery !== undefined) {
      row.is_digital_delivery = input.shipping.isDigitalDelivery;
    }
  }

  return row;
};

export const createMyArtwork = async (input) => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const profile = unwrap(
    await db.from('artist_profiles').select('id, status').eq('user_id', user.id).maybeSingle(),
  );

  if (!profile) throw new Error('Create your artist profile before adding artwork.');

  const row = unwrap(
    await db
      .from('artworks')
      .insert({ ...toArtworkRow(input), artist_id: profile.id, owner_id: user.id })
      .select('id, slug, status')
      .single(),
    'That piece could not be saved',
  );

  return { artwork: { id: row.id, slug: row.slug, status: row.status } };
};

export const updateMyArtwork = async (id, input) => {
  const db = client();

  const row = unwrap(
    await db.from('artworks').update(toArtworkRow(input)).eq('id', id).select('id, slug, status').single(),
    'That piece could not be saved',
  );

  return { artwork: { id: row.id, slug: row.slug, status: row.status } };
};

/**
 * Moves a listing between statuses.
 *
 * An artist can only reach 'pending' — the guard trigger refuses 'published'
 * and 'rejected' from a non-admin, which is what stops unreviewed work
 * reaching customers. So "publish" here means "submit for review", and the
 * returned message says so rather than implying it went live.
 */
export const setMyArtworkStatus = async (id, action) => {
  const db = client();

  const target =
    action === 'archive' ? 'archived' : action === 'unpublish' ? 'unpublished' : 'pending';

  const { data, error } = await db
    .from('artworks')
    .update({ status: target })
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) {
    // The trigger raises readable messages for an incomplete listing.
    throw new Error(supabaseError(error, 'That status could not be changed.'));
  }

  return {
    artwork: { id: data.id, status: data.status },
    message:
      data.status === 'pending'
        ? 'Submitted for review. Our curators will approve it shortly.'
        : `Artwork ${data.status}.`,
  };
};

export const deleteMyArtwork = async (id) => {
  const db = client();

  // A sold piece is part of an order's record. `order_items.artwork_id` is
  // ON DELETE RESTRICT, so the database refuses the delete and we archive
  // instead — the order history stays intact either way.
  const sold = unwrap(await db.from('order_items').select('id').eq('artwork_id', id).limit(1));

  if ((sold ?? []).length > 0) {
    unwrap(await db.from('artworks').update({ status: 'archived' }).eq('id', id));
    return {
      deleted: false,
      archived: true,
      message: 'This piece has been sold, so it was archived instead of deleted to keep order records intact.',
    };
  }

  const { error } = await db.from('artworks').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      unwrap(await db.from('artworks').update({ status: 'archived' }).eq('id', id));
      return { deleted: false, archived: true, message: 'Archived, because it is referenced by an order.' };
    }
    throw new Error(supabaseError(error, 'That piece could not be deleted.'));
  }

  return { deleted: true, archived: false };
};

/** Uploads artwork images into the artist's own folder. */
export const uploadArtworkImages = async (files) => {
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const uploaded = [];
  for (const file of files) {
    // Sequential rather than parallel: a browser throttles concurrent
    // uploads anyway, and this gives a clean error on the first failure.
    // eslint-disable-next-line no-await-in-loop
    const stored = await uploadImage('artworks', user.id, file, { prefix: 'listings' });
    uploaded.push({
      url: stored.url,
      thumbUrl: stored.url,
      publicId: stored.path,
      width: 0,
      height: 0,
      alt: '',
    });
  }

  return { images: uploaded };
};

/* ─────────────────────── Dashboard overview ─────────────────────── */

export const getArtistOverview = async () => {
  const db = client();
  const user = await currentUser();
  if (!user) throw new Error('Please sign in to continue.');

  const [profileResult, payout, artworkRows, actionRows, recentRows, settings] = await Promise.all([
    db
      .from('artist_public_profiles')
      .select('id, display_name, slug, status, avatar_url, review_note, published_artworks, total_sales')
      .eq('user_id', user.id)
      .maybeSingle(),
    db.rpc('artist_payout_summary', { p_artist_user_id: user.id }),
    db.from('artworks').select('status').eq('owner_id', user.id),
    db
      .from('order_items')
      .select('id, fulfilment_status')
      .in('fulfilment_status', ['awaiting', 'preparing']),
    db
      .from('order_items')
      .select('title, artist_earnings_minor, created_at, order:orders!inner ( order_number, status, created_at )')
      .order('created_at', { ascending: false })
      .limit(8),
    db.from('platform_settings').select('key, value'),
  ]);

  // A FAILED query and an ABSENT profile are different things, and conflating
  // them sent an approved artist to "You do not have an artist profile yet."
  // when the real fault was a query error (the profile select named a
  // column that did not exist). The artist was looking at their own name and
  // "Approved to sell" in the header while being told they had no profile.
  // Check the error first, and report it.
  if (profileResult.error) {
    throw new Error(supabaseError(profileResult.error, 'Could not load your dashboard'));
  }

  const profile = profileResult.data;
  if (!profile) {
    const notFound = new Error('You do not have an artist profile yet.');
    notFound.status = 404;
    throw notFound;
  }

  // The money summary is not allowed to fail quietly. `payout.data ?? {}`
  // turns every amount into 0, so an artist with real earnings would be shown
  // a confident zero balance - the single most misleading thing this page
  // could do. A failure here stops the page instead.
  if (payout.error) {
    throw new Error(supabaseError(payout.error, 'Could not load your sales figures'));
  }

  // The remaining panels are counts. A failure in one should not take the
  // whole dashboard down, but it must not read as zero either, so each is
  // named here and the page says which figures it could not load.
  const degraded = [];
  if (artworkRows.error) degraded.push('your artwork counts');
  if (actionRows.error) degraded.push('orders awaiting dispatch');
  if (recentRows.error) degraded.push('recent sales');

  const payoutData = payout.data ?? {};
  const settingMap = new Map((settings.data ?? []).map((row) => [row.key, row.value]));

  const artworks = (artworkRows.data ?? []).reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      acc.total += 1;
      return acc;
    },
    { total: 0 },
  );

  // Open enquiries, counted separately because RLS scopes it already.
  const enquiries = await db
    .from('commission_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'in_review', 'quoted']);

  // Group the recent lines by order so the list reads per-sale.
  const byOrder = new Map();
  (recentRows.data ?? []).forEach((item) => {
    if (!item.order) return;
    const key = item.order.order_number;
    if (!byOrder.has(key)) {
      byOrder.set(key, {
        orderNumber: key,
        status: item.order.status,
        createdAt: item.order.created_at,
        myEarningsMinor: 0,
        titles: [],
      });
    }
    const entry = byOrder.get(key);
    entry.myEarningsMinor += item.artist_earnings_minor;
    entry.titles.push(item.title);
  });

  return {
    profile: {
      displayName: profile.display_name,
      slug: profile.slug,
      status: profile.status,
      avatarUrl: profile.avatar_url,
      reviewNote: profile.review_note,
    },
    artworks,
    sales: {
      grossMinor: payoutData.gross_minor ?? 0,
      earningsMinor: payoutData.earnings_minor ?? 0,
      commissionMinor: payoutData.commission_minor ?? 0,
      unitsSold: payoutData.units_sold ?? 0,
      orderCount: byOrder.size,
      currency: payoutData.currency ?? 'INR',
      commissionPercent: Number(settingMap.get('commission_percent') ?? 10),
      // Settlement state, labelled honestly: eligible is NOT paid.
      pendingMinor: payoutData.pending_minor ?? 0,
      eligibleMinor: payoutData.eligible_minor ?? 0,
      onHoldMinor: payoutData.on_hold_minor ?? 0,
      transferredMinor: payoutData.transferred_minor ?? 0,
      returnWindowDays: payoutData.return_window_days ?? 7,
    },
    actionsNeeded: {
      ordersToFulfil: actionRows.error ? null : (actionRows.data ?? []).length,
      openEnquiries: enquiries.error ? null : (enquiries.count ?? 0),
    },
    recentOrders: [...byOrder.values()],
    // Empty when everything loaded. The page renders a note naming whatever
    // is in here, so a missing figure is visible as missing.
    degraded,
  };
};

/* ─────────────────────── Enquiries ─────────────────────── */

const toEnquiry = (row) => ({
  id: row.id,
  reference: row.reference,
  kind: row.kind,
  status: row.status,
  subject: row.subject,
  message: row.message,
  contactName: row.contact_name,
  contactEmail: row.contact_email,
  contactPhone: row.contact_phone,
  styleKey: row.style_key,
  preferredSize: row.preferred_size,
  budgetMinor: row.budget_minor,
  deadline: row.deadline,
  quotedAmountMinor: row.quoted_amount_minor,
  quoteNote: row.quote_note,
  referenceImages: row.reference_images ?? [],
  photoConsent: row.photo_consent,
  messages: row.messages ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  artist: row.artist ? { id: row.artist.id, displayName: row.artist.display_name, slug: row.artist.slug } : null,
  artwork: row.artwork ? { id: row.artwork.id, title: row.artwork.title, slug: row.artwork.slug } : null,
});

export const listArtistEnquiries = async ({ page = 1, limit = 20, status } = {}) => {
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('commission_requests')
    .select('*, artwork:artworks ( id, title, slug )', { count: 'exact' });

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load your enquiries');

  const total = count ?? 0;

  return {
    items: (data ?? []).map(toEnquiry),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const respondToEnquiry = async (id, { status, quotedAmount, quoteNote, reply }) => {
  const db = client();
  const user = await currentUser();

  const existing = unwrap(
    await db.from('commission_requests').select('messages').eq('id', id).single(),
  );

  const payload = {};
  if (status) payload.status = status;
  if (quoteNote !== undefined) payload.quote_note = quoteNote;
  if (quotedAmount !== undefined) {
    payload.quoted_amount_minor =
      quotedAmount == null || quotedAmount === '' ? null : Math.round(Number(quotedAmount) * 100);
  }

  if (reply?.trim()) {
    payload.messages = [
      ...(existing.messages ?? []),
      { from: user?.id, fromRole: 'artist', body: reply.trim(), at: new Date().toISOString() },
    ];
  }

  const row = unwrap(
    await db
      .from('commission_requests')
      .update(payload)
      .eq('id', id)
      .select('*, artwork:artworks ( id, title, slug )')
      .single(),
    'That reply could not be sent',
  );

  return { request: toEnquiry(row) };
};

/* ─────────────────────── Customer-side commissions ─────────────────────── */

export const listMyCommissionRequests = async () => {
  const db = client();

  const rows = unwrap(
    await db
      .from('commission_requests')
      .select('*, artist:artist_profiles ( id, display_name, slug ), artwork:artworks ( id, title, slug )')
      .order('created_at', { ascending: false }),
    'Could not load your enquiries',
  );

  return { items: (rows ?? []).map(toEnquiry) };
};

export const createCommissionRequest = async (input, files = []) => {
  const db = client();
  const user = await currentUser();

  // A private photograph is only stored when consent was explicitly given.
  const referenceImages = [];
  if (files.length) {
    if (!input.photoConsent) {
      throw new Error('Tick the consent box before sending your photograph.');
    }
    if (!user) {
      throw new Error('Please sign in to attach a photograph to your brief.');
    }
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await uploadImage('commission-references', user.id, file);
      referenceImages.push({ url: stored.url, publicId: stored.path });
    }
  }

  let artistId = input.artistId ?? null;
  let artistUserId = null;

  if (input.artworkId && !artistId) {
    const art = unwrap(await db.from('artworks').select('artist_id').eq('id', input.artworkId).maybeSingle());
    artistId = art?.artist_id ?? null;
  }

  if (artistId) {
    const profile = unwrap(await db.from('artist_profiles').select('user_id').eq('id', artistId).maybeSingle());
    artistUserId = profile?.user_id ?? null;
  }

  const reference = `CMS-${Date.now().toString(36).toUpperCase()}`;

  const row = unwrap(
    await db
      .from('commission_requests')
      .insert({
        reference,
        kind: input.kind ?? 'commission',
        customer_id: user?.id ?? null,
        contact_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone ?? '',
        artist_id: artistId,
        artist_user_id: artistUserId,
        artwork_id: input.artworkId ?? null,
        subject: input.subject ?? '',
        message: input.message,
        style_key: input.styleKey ?? '',
        reference_images: referenceImages,
        photo_consent: Boolean(input.photoConsent),
        preferred_size: input.preferredSize ?? '',
        budget_minor:
          input.budget == null || input.budget === '' ? null : Math.round(Number(input.budget) * 100),
        deadline: input.deadline ?? null,
      })
      .select('*')
      .single(),
    'That brief could not be sent',
  );

  return {
    request: toEnquiry(row),
    // Honest: no email is sent unless the project has SMTP configured, which
    // Supabase Auth does not do for arbitrary transactional mail.
    emailSent: false,
    notice:
      'Your request is saved and visible to the studio in their dashboard. Email notifications are not configured on this project.',
  };
};
