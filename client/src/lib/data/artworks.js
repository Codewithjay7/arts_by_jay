import client, { unwrap } from '../supabase';

/**
 * Artwork reads against Supabase.
 *
 * Every function here returns the SAME shape the Express API returned, so the
 * components that consume them do not change during the migration. That keeps
 * the port mechanical and reviewable: one data layer swapped, no UI churn.
 *
 * Note what is absent: no function filters by `status = 'published'`. It does
 * not need to. The RLS policy on `artworks` only ever exposes published rows
 * to an anonymous or customer session, so a draft cannot leak even if a query
 * here forgot to exclude it. Defence in the database, not in the caller.
 */

/**
 * Every column a card needs EXCEPT the artist embed.
 *
 * The artist embed is kept separate because the detail views need a richer
 * one. Appending a second `artist:artist_profiles ( ... )` to a select that
 * already contains one does NOT widen the first: both resolve to the same
 * relationship, and PostgREST rejects the whole query with
 *   "table name \"artworks_artist_1\" specified more than once"
 * which is how the artwork detail page and the gallery zoom panel came to
 * fail with "That did not load". Composing one embed per query instead of
 * concatenating two makes that mistake impossible to repeat.
 */
const CARD_BASE_COLUMNS = `
  id, title, slug, price_minor, compare_at_price_minor, currency,
  images, type, medium, style, orientation,
  width_cm, height_cm, depth_cm,
  stock, allow_backorder, is_digital_delivery, is_unique, status,
  is_featured, in_virtual_gallery, published_at,
  rating_average, rating_count, units_sold,
  category:categories ( id, name, slug )
`;

/** The slim artist embed: all a card renders. */
const CARD_ARTIST_EMBED = 'artist:artist_profiles ( id, display_name, slug )';

/** The full artist embed, for the detail and gallery views. */
const DETAIL_ARTIST_EMBED = `
  artist:artist_profiles ( id, display_name, slug, bio, avatar_url, location,
                           accepts_commissions, commission_note )
`;

const CARD_COLUMNS = `${CARD_BASE_COLUMNS}, ${CARD_ARTIST_EMBED}`;

/** Maps a database row onto the card shape the UI already expects. */
export const toCard = (row) => {
  if (!row) return null;

  const image = Array.isArray(row.images) ? row.images[0] : null;
  const soldOut = !row.is_digital_delivery && !row.allow_backorder && (row.stock ?? 0) <= 0;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    priceMinor: row.price_minor,
    compareAtPriceMinor: row.compare_at_price_minor,
    currency: row.currency,
    image: image
      ? { url: image.url, thumbUrl: image.thumbUrl || image.url, alt: image.alt || row.title }
      : null,
    type: row.type,
    medium: row.medium,
    style: row.style,
    orientation: row.orientation,
    dimensions:
      row.width_cm || row.height_cm
        ? { width: row.width_cm, height: row.height_cm, depth: row.depth_cm, unit: 'cm' }
        : null,
    stock: row.stock,
    isSoldOut: soldOut,
    isPurchasable: row.status === 'published' && row.type !== 'commission' && !soldOut,
    isFeatured: Boolean(row.is_featured),
    rating: { average: row.rating_average ?? 0, count: row.rating_count ?? 0 },
    artist: row.artist ? { id: row.artist.id, displayName: row.artist.display_name, slug: row.artist.slug } : null,
    category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug } : null,
    publishedAt: row.published_at,
  };
};

const SORTS = {
  newest: { column: 'published_at', ascending: false },
  oldest: { column: 'published_at', ascending: true },
  price_asc: { column: 'price_minor', ascending: true },
  price_desc: { column: 'price_minor', ascending: false },
  popular: { column: 'units_sold', ascending: false },
};

/**
 * The storefront grid, with search, filters, sort and pagination.
 *
 * `count: 'exact'` makes PostgREST return the total alongside the page, so
 * pagination needs one round trip rather than two.
 */
export const browseArtworks = async (params = {}) => {
  const db = client();
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(params.limit) || 12));
  const from = (page - 1) * limit;

  let query = db
    .from('artworks')
    .select(CARD_COLUMNS, { count: 'exact' })
    .eq('status', 'published');

  if (params.q) {
    // Matches the GIN full-text index created in 0002.
    query = query.textSearch('title', params.q, { type: 'websearch', config: 'english' });
  }

  if (params.category) {
    // Resolve the slug, and include its direct children so a parent category
    // shows everything beneath it.
    const parent = unwrap(
      await db.from('categories').select('id').eq('slug', params.category).maybeSingle(),
    );
    if (!parent) {
      return { items: [], meta: { page, limit, total: 0, totalPages: 1, hasMore: false } };
    }
    const children = unwrap(await db.from('categories').select('id').eq('parent_id', parent.id));
    query = query.in('category_id', [parent.id, ...(children ?? []).map((c) => c.id)]);
  }

  if (params.artist) {
    const artist = unwrap(
      await db.from('artist_profiles').select('id').eq('slug', params.artist).maybeSingle(),
    );
    if (!artist) {
      return { items: [], meta: { page, limit, total: 0, totalPages: 1, hasMore: false } };
    }
    query = query.eq('artist_id', artist.id);
  }

  if (params.type) query = query.eq('type', params.type);
  if (params.orientation) query = query.eq('orientation', params.orientation);
  if (params.medium) query = query.ilike('medium', `%${params.medium}%`);
  if (params.style) query = query.ilike('style', `%${params.style}%`);
  if (params.featured !== undefined) query = query.eq('is_featured', params.featured);
  if (params.tags?.length) query = query.overlaps('tags', params.tags);

  // Prices arrive from the UI in rupees; the column is paise.
  if (params.minPrice !== undefined && params.minPrice !== '') {
    query = query.gte('price_minor', Math.round(Number(params.minPrice) * 100));
  }
  if (params.maxPrice !== undefined && params.maxPrice !== '') {
    query = query.lte('price_minor', Math.round(Number(params.maxPrice) * 100));
  }

  if (params.availability === 'available') {
    query = query.or('stock.gt.0,allow_backorder.is.true,is_digital_delivery.is.true');
  } else if (params.availability === 'sold') {
    query = query.lte('stock', 0).eq('allow_backorder', false).eq('is_digital_delivery', false);
  }

  const sort = SORTS[params.sort] ?? SORTS.newest;
  query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order('id');

  const { data, error, count } = await query.range(from, from + limit - 1);
  unwrap({ data, error }, 'Could not load the collection');

  const total = count ?? 0;

  return {
    items: (data ?? []).map(toCard),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: from + limit < total,
    },
  };
};

/** Distinct values actually present in the catalogue, for the filter UI. */
export const getFacets = async () => {
  const db = client();

  // One pass over the published rows; cheaper than three distinct queries and
  // PostgREST has no DISTINCT.
  const rows = unwrap(
    await db.from('artworks').select('medium, style, tags, price_minor').eq('status', 'published'),
  );

  const mediums = new Set();
  const styles = new Set();
  const tags = new Set();
  let min = Infinity;
  let max = 0;

  (rows ?? []).forEach((row) => {
    if (row.medium) mediums.add(row.medium);
    if (row.style) styles.add(row.style);
    (row.tags ?? []).forEach((tag) => tag && tags.add(tag));
    if (row.price_minor < min) min = row.price_minor;
    if (row.price_minor > max) max = row.price_minor;
  });

  return {
    mediums: [...mediums].sort(),
    styles: [...styles].sort(),
    tags: [...tags].sort().slice(0, 60),
    price: { minMinor: Number.isFinite(min) ? min : 0, maxMinor: max },
  };
};

/** The home page's curated rails, in parallel. */
export const getHomeCollections = async () => {
  const db = client();

  const pick = (extra) => {
    let query = db.from('artworks').select(CARD_COLUMNS).eq('status', 'published');
    if (extra.type) query = query.eq('type', extra.type);
    if (extra.featured) query = query.eq('is_featured', true);
    return query
      .order(extra.by ?? 'published_at', { ascending: false, nullsFirst: false })
      .limit(extra.limit ?? 8);
  };

  const [featured, newArrivals, trending, originals, prints] = await Promise.all([
    pick({ featured: true, limit: 6 }),
    pick({ limit: 8 }),
    pick({ by: 'units_sold', limit: 8 }),
    pick({ type: 'original', limit: 8 }),
    pick({ type: 'print', limit: 8 }),
  ]);

  return {
    featured: (unwrap(featured) ?? []).map(toCard),
    newArrivals: (unwrap(newArrivals) ?? []).map(toCard),
    trending: (unwrap(trending) ?? []).map(toCard),
    originals: (unwrap(originals) ?? []).map(toCard),
    prints: (unwrap(prints) ?? []).map(toCard),
  };
};

/** The full detail page payload: artwork, related work and reviews. */
export const getArtworkDetail = async (slug) => {
  const db = client();

  const row = unwrap(
    await db
      .from('artworks')
      .select(
        `${CARD_BASE_COLUMNS}, description, story, year, tags, is_framed, weight_grams,
         ships_from, processing_days, shipping_flat_minor,
         ${DETAIL_ARTIST_EMBED}`,
      )
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle(),
  );

  if (!row) {
    const notFound = new Error('That artwork is not available.');
    notFound.status = 404;
    throw notFound;
  }

  const [related, reviews, session] = await Promise.all([
    db
      .from('artworks')
      .select(CARD_COLUMNS)
      .eq('status', 'published')
      .neq('id', row.id)
      .or(`category_id.eq.${row.category?.id ?? row.id},artist_id.eq.${row.artist?.id ?? row.id}`)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(8),
    db
      .from('reviews')
      .select('id, rating, title, body, is_verified_purchase, created_at, author:profiles ( full_name, avatar_url )')
      .eq('artwork_id', row.id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(20),
    db.auth.getSession(),
  ]);

  // The wishlist check only means anything for a signed-in visitor, and RLS
  // would return nothing for anyone else anyway.
  let isWishlisted = false;
  const userId = session?.data?.session?.user?.id;
  if (userId) {
    const saved = unwrap(
      await db
        .from('wishlist_items')
        .select('id')
        .eq('user_id', userId)
        .eq('artwork_id', row.id)
        .maybeSingle(),
    );
    isWishlisted = Boolean(saved);
  }

  // The view counter is advisory; a failure must not break the page.
  db.rpc('increment_artwork_views', { p_artwork_id: row.id }).then(
    () => {},
    () => {},
  );

  return {
    artwork: {
      ...toCard(row),
      description: row.description,
      story: row.story,
      year: row.year,
      tags: row.tags,
      isFramed: row.is_framed,
      weightGrams: row.weight_grams,
      allowBackorder: row.allow_backorder,
      images: (row.images ?? []).map((image) => ({
        url: image.url,
        thumbUrl: image.thumbUrl || image.url,
        alt: image.alt || row.title,
        width: image.width,
        height: image.height,
      })),
      shipping: {
        shipsFrom: row.ships_from ?? '',
        processingDays: row.processing_days ?? 3,
        flatRateMinor: row.shipping_flat_minor ?? 0,
        isDigitalDelivery: Boolean(row.is_digital_delivery),
      },
      artist: row.artist
        ? {
            id: row.artist.id,
            displayName: row.artist.display_name,
            slug: row.artist.slug,
            bio: row.artist.bio,
            avatarUrl: row.artist.avatar_url,
            location: row.artist.location,
            acceptsCommissions: row.artist.accepts_commissions,
            commissionNote: row.artist.commission_note,
          }
        : null,
      viewerState: { isWishlisted },
    },
    related: (unwrap(related) ?? []).map(toCard),
    reviews: (unwrap(reviews) ?? []).map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      isVerifiedPurchase: review.is_verified_purchase,
      createdAt: review.created_at,
      author: {
        name: review.author?.full_name || 'Collector',
        avatarUrl: review.author?.avatar_url ?? '',
      },
    })),
  };
};

/** The public category tree, with counts. */
export const listCategories = async () => {
  const db = client();

  const [categories, counts] = await Promise.all([
    db.from('categories').select('id, name, slug, description, image_url, is_featured, parent_id, sort_order').order('sort_order').order('name'),
    db.from('artworks').select('category_id').eq('status', 'published'),
  ]);

  const rows = unwrap(categories) ?? [];
  const countMap = new Map();
  (unwrap(counts) ?? []).forEach((row) => {
    countMap.set(row.category_id, (countMap.get(row.category_id) ?? 0) + 1);
  });

  const shape = (row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.image_url,
    isFeatured: row.is_featured,
    artworkCount: countMap.get(row.id) ?? 0,
    children: [],
  });

  const byId = new Map(rows.map((row) => [row.id, shape(row)]));
  const roots = [];

  rows.forEach((row) => {
    const node = byId.get(row.id);
    if (row.parent_id && byId.has(row.parent_id)) byId.get(row.parent_id).children.push(node);
    else roots.push(node);
  });

  // A parent's count includes everything beneath it.
  roots.forEach((root) => {
    root.artworkCount += root.children.reduce((sum, child) => sum + child.artworkCount, 0);
  });

  return { items: roots, flat: [...byId.values()] };
};

/**
 * One artwork for the gallery's focus panel, by id.
 *
 * Reads the SAME product row the shop sells. There is no separate gallery
 * catalogue, so adding to the cart from inside the corridor and from the shop
 * are the same operation on the same record.
 *
 * A piece can sell or be unpublished while a visitor is mid-corridor, so a
 * miss returns alternatives rather than a dead panel.
 */
export const getGalleryArtwork = async (artworkId) => {
  const db = client();

  const row = unwrap(
    await db
      .from('artworks')
      .select(
        `${CARD_BASE_COLUMNS}, description, story, year, tags, is_framed,
         ships_from, processing_days,
         ${DETAIL_ARTIST_EMBED}`,
      )
      .eq('id', artworkId)
      .eq('status', 'published')
      .maybeSingle(),
    'Could not load that piece',
  );

  if (!row) {
    const alternatives = unwrap(
      await db
        .from('artworks')
        .select(CARD_COLUMNS)
        .eq('status', 'published')
        .eq('in_virtual_gallery', true)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(4),
    );

    const gone = new Error('That piece is no longer on display.');
    gone.code = 'ARTWORK_GONE';
    gone.alternatives = (alternatives ?? []).map(toCard);
    throw gone;
  }

  return {
    artwork: {
      ...toCard(row),
      description: row.description,
      story: row.story,
      year: row.year,
      tags: row.tags,
      isFramed: row.is_framed,
      images: (row.images ?? []).map((image) => ({
        url: image.url,
        thumbUrl: image.thumbUrl || image.url,
        alt: image.alt || row.title,
      })),
      shipping: {
        shipsFrom: row.ships_from ?? '',
        processingDays: row.processing_days ?? 3,
        isDigitalDelivery: Boolean(row.is_digital_delivery),
      },
      artist: row.artist
        ? {
            id: row.artist.id,
            displayName: row.artist.display_name,
            slug: row.artist.slug,
            bio: row.artist.bio,
            avatarUrl: row.artist.avatar_url,
            acceptsCommissions: row.artist.accepts_commissions,
            commissionNote: row.artist.commission_note,
          }
        : null,
    },
  };
};
