import client, { unwrap, supabaseError } from '../supabase';
import { toCard } from './artworks';

/**
 * Cart and wishlist against Supabase.
 *
 * Both go through SECURITY DEFINER RPCs rather than direct table writes,
 * because the rules that matter — an original is one of one, stock caps the
 * quantity, a sold-out or commission-only piece is refused — have to be
 * enforced where a client cannot reach around them. A direct INSERT policy on
 * `cart_items` would let the browser pick any quantity it liked.
 *
 * The server re-prices on every read, so these functions never compute a
 * total. They only reshape what the database returned.
 */

const CART_COLUMNS = `
  quantity,
  price_at_add_minor,
  artwork:artworks (
    id, title, slug, price_minor, compare_at_price_minor, currency,
    images, type, medium, style, orientation,
    width_cm, height_cm, depth_cm,
    stock, allow_backorder, is_digital_delivery, is_unique, status,
    is_featured, rating_average, rating_count,
    artist:artist_profiles ( id, display_name, slug ),
    category:categories ( id, name, slug )
  )
`;

const SHIPPING_METHODS = [
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

export { SHIPPING_METHODS };

const currentUserId = async () => {
  const { data } = await client().auth.getSession();
  return data?.session?.user?.id ?? null;
};

/**
 * Reads the cart and its server-computed summary.
 *
 * Two queries rather than one: the rows give the UI what to render, and
 * `cart_summary` gives the authoritative totals and any issues (a price that
 * changed, a quantity that had to be reduced). Reconciling those client-side
 * would mean duplicating the pricing rules.
 */
export const getCart = async ({ shippingMethod = 'standard' } = {}) => {
  const db = client();
  const userId = await currentUserId();

  if (!userId) {
    return {
      items: [],
      totals: { subtotalMinor: 0, shippingTotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: 'INR', itemCount: 0 },
      issues: [],
      shippingMethod,
      shippingMethods: SHIPPING_METHODS,
    };
  }

  const [rows, summary] = await Promise.all([
    db.from('cart_items').select(CART_COLUMNS).order('added_at', { ascending: true }),
    db.rpc('cart_summary', { p_user_id: userId }),
  ]);

  const cartRows = unwrap(rows, 'Could not load your cart') ?? [];
  const totals = unwrap(summary, 'Could not price your cart') ?? {};

  // The uplift is a presentation concern here; checkout recomputes it.
  const uplift = SHIPPING_METHODS.find((method) => method.key === shippingMethod)?.upliftMinor ?? 0;
  const hasPhysical = cartRows.some((row) => row.artwork && !row.artwork.is_digital_delivery);
  const shippingTotalMinor = (totals.shipping_total_minor ?? 0) + (hasPhysical ? uplift : 0);

  const items = cartRows
    .filter((row) => row.artwork)
    .map((row) => {
      const card = toCard(row.artwork);
      const digital = Boolean(row.artwork.is_digital_delivery);

      return {
        artwork: card,
        quantity: row.quantity,
        unitPriceMinor: row.artwork.price_minor,
        lineTotalMinor: row.artwork.price_minor * row.quantity,
        shippingMinor: digital ? 0 : (row.artwork.shipping_flat_minor ?? 0),
        isDigital: digital,
      };
    });

  return {
    items,
    totals: {
      subtotalMinor: totals.subtotal_minor ?? 0,
      shippingTotalMinor,
      discountMinor: 0,
      totalMinor: (totals.subtotal_minor ?? 0) + shippingTotalMinor,
      currency: totals.currency ?? 'INR',
      itemCount: totals.item_count ?? 0,
    },
    issues: (totals.issues ?? []).map((issue) => ({
      artworkId: issue.artwork_id,
      kind: issue.kind,
      message: issue.message,
    })),
    canProceed: totals.can_proceed ?? false,
    shippingMethod,
    shippingMethods: SHIPPING_METHODS,
  };
};

/**
 * Adds to the cart. The quantity is a request: the database decides what is
 * actually allowed and the refreshed cart reflects that.
 */
export const addToCart = async (artworkId, quantity = 1) => {
  const db = client();

  const { error } = await db.rpc('add_to_cart', { p_artwork_id: artworkId, p_quantity: quantity });
  if (error) throw new Error(supabaseError(error, 'That could not be added to your cart.'));

  return getCart();
};

export const setCartQuantity = async (artworkId, quantity) => {
  const db = client();

  const { error } = await db.rpc('set_cart_quantity', { p_artwork_id: artworkId, p_quantity: quantity });
  if (error) throw new Error(supabaseError(error, 'That quantity could not be set.'));

  return getCart();
};

export const removeFromCart = async (artworkId) => setCartQuantity(artworkId, 0);

export const clearCart = async () => {
  const db = client();
  const userId = await currentUserId();
  if (!userId) return getCart();

  // RLS scopes the delete to the caller's own cart, so no user filter is
  // needed here — and adding one would not make it safer.
  const carts = unwrap(await db.from('carts').select('id').eq('user_id', userId));
  const ids = (carts ?? []).map((cart) => cart.id);

  if (ids.length) {
    unwrap(await db.from('cart_items').delete().in('cart_id', ids), 'Could not empty your cart');
  }

  return getCart();
};

/* ──────────────────────────── Wishlist ──────────────────────────── */

export const getWishlist = async () => {
  const db = client();
  const userId = await currentUserId();

  if (!userId) return { items: [], total: 0 };

  const rows = unwrap(
    await db
      .from('wishlist_items')
      .select(`created_at, artwork:artworks ( ${`
        id, title, slug, price_minor, compare_at_price_minor, currency,
        images, type, medium, style, orientation,
        width_cm, height_cm, depth_cm,
        stock, allow_backorder, is_digital_delivery, is_unique, status,
        is_featured, rating_average, rating_count,
        artist:artist_profiles ( id, display_name, slug ),
        category:categories ( id, name, slug )
      `.trim()} )`)
      .order('created_at', { ascending: false }),
    'Could not load your wishlist',
  );

  // A piece that has since been unpublished is hidden by RLS, so the join
  // comes back null. Drop those rather than rendering a blank card.
  const items = (rows ?? []).filter((row) => row.artwork).map((row) => toCard(row.artwork));

  return { items, total: items.length };
};

export const getWishlistIds = async () => {
  const db = client();
  const userId = await currentUserId();
  if (!userId) return [];

  const rows = unwrap(await db.from('wishlist_items').select('artwork_id'));
  return (rows ?? []).map((row) => row.artwork_id);
};

export const toggleWishlist = async (artworkId) => {
  const db = client();

  const { data, error } = await db.rpc('toggle_wishlist', { p_artwork_id: artworkId });
  if (error) throw new Error(supabaseError(error, 'Your wishlist could not be updated.'));

  return { added: data?.added === true, total: data?.total ?? 0 };
};

export const removeFromWishlist = async (artworkId) => {
  const db = client();
  const userId = await currentUserId();
  if (!userId) return { removed: false, total: 0 };

  unwrap(
    await db.from('wishlist_items').delete().eq('user_id', userId).eq('artwork_id', artworkId),
    'Could not remove that from your wishlist',
  );

  const remaining = await getWishlistIds();
  return { removed: true, total: remaining.length };
};

/* ──────────────────────────── Addresses ──────────────────────────── */

const toAddress = (row) => ({
  id: row.id,
  label: row.label,
  fullName: row.full_name,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  state: row.state,
  postalCode: row.postal_code,
  country: row.country,
  isDefault: row.is_default,
});

export const listAddresses = async () => {
  const db = client();

  const rows = unwrap(
    await db
      .from('addresses')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false }),
    'Could not load your addresses',
  );

  return { items: (rows ?? []).map(toAddress) };
};

const fromAddress = (input) => ({
  label: input.label ?? 'Home',
  full_name: input.fullName,
  phone: input.phone,
  line1: input.line1,
  line2: input.line2 ?? '',
  city: input.city,
  state: input.state,
  postal_code: input.postalCode,
  country: input.country ?? 'India',
  is_default: Boolean(input.isDefault),
});

export const createAddress = async (input) => {
  const db = client();
  const userId = await currentUserId();
  if (!userId) throw new Error('Please sign in to continue.');

  const existing = unwrap(await db.from('addresses').select('id').eq('user_id', userId));
  const isFirst = (existing ?? []).length === 0;

  const row = unwrap(
    await db
      .from('addresses')
      .insert({ ...fromAddress(input), user_id: userId, is_default: isFirst || Boolean(input.isDefault) })
      .select('*')
      .single(),
    'That address could not be saved',
  );

  // Only one default at a time.
  if (row.is_default) {
    await db.from('addresses').update({ is_default: false }).eq('user_id', userId).neq('id', row.id);
  }

  return toAddress(row);
};

export const updateAddress = async (id, input) => {
  const db = client();
  const userId = await currentUserId();

  const row = unwrap(
    await db.from('addresses').update(fromAddress(input)).eq('id', id).select('*').single(),
    'That address could not be saved',
  );

  if (row.is_default && userId) {
    await db.from('addresses').update({ is_default: false }).eq('user_id', userId).neq('id', row.id);
  }

  return toAddress(row);
};

export const deleteAddress = async (id) => {
  const db = client();
  unwrap(await db.from('addresses').delete().eq('id', id), 'That address could not be removed');
  return { ok: true };
};
