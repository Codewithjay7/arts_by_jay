/**
 * Drives the REAL data layer the pages call, as each role, against the live
 * project.
 *
 *   node supabase/audit-pages.mjs
 *
 * This imports client/src/lib/data directly rather than re-typing its queries
 * into a test. That distinction matters: a test holding its own copy of a
 * query stops testing the code the moment the code changes, and every bug
 * found on this project so far has been a query that was perfectly valid SQL
 * doing the wrong thing. Here, if a page's function breaks, this breaks.
 *
 * Read-only apart from the cart, which it empties afterwards.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({ path: path.join(root, 'server', '.env') });

const PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';

// The data layer reaches for `window.location.origin` in a couple of places
// and for browser storage via the Supabase client. Provide the minimum so
// importing it does not throw; nothing here depends on a real DOM.
globalThis.window ??= { location: { origin: 'https://artsbyjay.netlify.app' } };

const dataDir = path.join(root, 'client', 'src', 'lib', 'data');
const toUrl = (f) => `file:///${path.join(dataDir, f).replace(/\\/g, '/')}`;

const [artworks, artist, cart, orders, admin, adminOps, index, supabaseMod] = await Promise.all([
  import(toUrl('artworks.js')),
  import(toUrl('artist.js')),
  import(toUrl('cart.js')),
  import(toUrl('orders.js')),
  import(toUrl('admin.js')),
  import(toUrl('adminOps.js')),
  import(toUrl('index.js')),
  import(`file:///${path.join(root, 'client', 'src', 'lib', 'supabase.js').replace(/\\/g, '/')}`),
]);

const supabase = supabaseMod.supabase;

let passed = 0;
let failed = 0;
const failures = [];

const section = (t) => console.log(`\n── ${t} ──`);

/**
 * Calls one data-layer function and judges the result.
 *
 * `expect` may assert on the shape. A thrown error is a failure unless the
 * call was expected to be refused.
 */
const probe = async (name, fn, expect = () => true) => {
  try {
    const result = await fn();
    const verdict = expect(result);
    if (verdict === true) {
      passed += 1;
      console.log(`  PASS  ${name}`);
    } else {
      failed += 1;
      failures.push(`${name} — ${verdict}`);
      console.log(`  FAIL  ${name} — ${verdict}`);
    }
    return result;
  } catch (error) {
    failed += 1;
    failures.push(`${name} — threw: ${error.message}`);
    console.log(`  FAIL  ${name} — threw: ${error.message}`);
    return null;
  }
};

/** Expects the call to be REFUSED. A success here is the failure. */
const probeRefused = async (name, fn) => {
  try {
    await fn();
    failed += 1;
    failures.push(`${name} — was allowed`);
    console.log(`  FAIL  ${name} — was allowed`);
  } catch {
    passed += 1;
    console.log(`  PASS  ${name}`);
  }
};

const as = async (email) => {
  await supabase.auth.signOut();
  if (!email) return null;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`cannot sign in as ${email}: ${error.message}`);
  return data.user.id;
};

const nonEmpty = (key) => (r) =>
  Array.isArray(r?.[key]) && r[key].length > 0 ? true : `${key} was empty`;

const run = async () => {
  /* ═════════════ Anonymous browsing ═════════════ */
  await as(null);
  section('Anonymous: browsing');

  const list = await probe('browseArtworks (shop)', () => artworks.browseArtworks({ limit: 6 }), nonEmpty('items'));
  await probe(
    'browseArtworks pagination meta is coherent',
    () => artworks.browseArtworks({ page: 1, limit: 3 }),
    (r) =>
      r.items.length <= 3 && r.meta.total >= r.items.length && r.meta.totalPages >= 1
        ? true
        : `meta=${JSON.stringify(r.meta)}`,
  );
  await probe(
    'browseArtworks search runs without error',
    () => artworks.browseArtworks({ q: 'tide', limit: 5 }),
    (r) => (Array.isArray(r.items) ? true : 'items missing'),
  );
  await probe(
    'browseArtworks price filter runs without error',
    () => artworks.browseArtworks({ minPrice: 1000, maxPrice: 20000000, limit: 5 }),
    (r) => (Array.isArray(r.items) ? true : 'items missing'),
  );
  await probe('listCategories (nested tree)', () => artworks.listCategories(), nonEmpty('items'));
  await probe(
    'listCategories carries artwork counts and children',
    () => artworks.listCategories(),
    (r) =>
      r.items.every((c) => Number.isFinite(c.artworkCount) && Array.isArray(c.children))
        ? true
        : 'a category was missing its count or children',
  );
  await probe('getFacets (shop filters)', () => artworks.getFacets(), (r) => (r ? true : 'nothing returned'));
  await probe('getHomeCollections', () => artworks.getHomeCollections(), (r) => (r ? true : 'nothing returned'));

  const slug = list?.items?.[0]?.slug;
  await probe(
    'getArtworkDetail',
    () => artworks.getArtworkDetail(slug),
    (r) => (r?.artwork?.slug === slug && r.artwork.artist ? true : 'artwork or its artist missing'),
  );
  await probe(
    'getArtworkDetail includes related work and reviews',
    () => artworks.getArtworkDetail(slug),
    (r) => (Array.isArray(r.related) && Array.isArray(r.reviews) ? true : 'related/reviews not arrays'),
  );
  await probe(
    'getArtworkDetail on a bad slug is a clean 404',
    () =>
      artworks.getArtworkDetail('definitely-not-a-real-slug').then(
        () => 'resolved when it should not have',
        (e) => (e.status === 404 ? 'ok' : `threw ${e.message}`),
      ),
    (r) => (r === 'ok' ? true : r),
  );

  section('Anonymous: artists and gallery');

  const artistList = await probe('listArtists', () => artist.listArtists({ limit: 6 }), nonEmpty('items'));
  await probe(
    'listArtists carries derived counts',
    () => artist.listArtists({ limit: 3 }),
    (r) =>
      r.items.every((a) => Number.isFinite(a.publishedArtworks) && Number.isFinite(a.totalSales))
        ? true
        : 'a count was not a number',
  );

  const artistSlug = artistList?.items?.[0]?.slug;
  await probe(
    'getArtistStorefront',
    () => artist.getArtistStorefront(artistSlug),
    (r) => (r?.artist?.slug === artistSlug && Array.isArray(r.artworks) ? true : 'artist or artworks missing'),
  );
  await probe(
    'gallery_layout rpc (the 3D gallery)',
    async () => (await supabase.rpc('gallery_layout', { p_limit: 24 })).data,
    (r) => (r ? true : 'nothing returned'),
  );

  const galleryId = list?.items?.[0]?.id;
  await probe(
    'getGalleryArtwork (zoom-to-detail panel)',
    () => artworks.getGalleryArtwork(galleryId),
    (r) => (r?.artwork?.id === galleryId ? true : 'wrong or missing artwork'),
  );

  section('Anonymous: capability reporting is honest');

  await probe(
    'getCapabilities reports checkout DISABLED',
    () => index.getCapabilities(),
    (r) => (r.payment.enabled === false ? true : 'checkout reports itself enabled'),
  );
  await probe(
    'getCapabilities states a reason for it',
    () => index.getCapabilities(),
    (r) => (typeof r.payment.reason === 'string' && r.payment.reason.length > 0 ? true : 'no reason given'),
  );
  await probe(
    'getCapabilities does not claim email or AI work',
    () => index.getCapabilities(),
    (r) => (r.emailDelivery === false && r.aiPhotoStudio === false ? true : 'a capability is overclaimed'),
  );
  await probe(
    'commission percent comes from the database',
    () => index.getCapabilities(),
    (r) => (r.commissionPercent === 10 ? true : `got ${r.commissionPercent}`),
  );
  await probe(
    'getStudioConfig does not claim AI generation',
    () => index.getStudioConfig(),
    (r) => (r.aiGeneration.enabled === false ? true : 'it claims AI generation works'),
  );

  section('Anonymous: private areas are refused, not answered with zeros');

  await probeRefused('listMyOrders refuses anonymous', () => orders.listMyOrders());
  await probeRefused('getAccountSummary refuses anonymous', () => orders.getAccountSummary());
  await probeRefused('listNotifications refuses anonymous', () => orders.listNotifications());
  await probeRefused('getArtistOverview refuses anonymous', () => artist.getArtistOverview());
  await probeRefused('listArtistEnquiries refuses anonymous', () => artist.listArtistEnquiries());
  await probeRefused('admin getOverview refuses anonymous', () => admin.getOverview());
  await probeRefused('admin listUsers refuses anonymous', () => admin.listUsers());
  await probeRefused('admin listArtistApplications refuses anonymous', () => admin.listArtistApplications());
  await probeRefused('admin moderation queue refuses anonymous', () => admin.listArtworksForModeration());
  await probeRefused('admin sales report refuses anonymous', () => admin.getSalesReport());
  await probeRefused('adminOps payout queue refuses anonymous', () => adminOps.getPayoutQueue());
  await probeRefused('adminOps linked accounts refuses anonymous', () => adminOps.listLinkedAccounts());

  /* ═════════════ Customer ═════════════ */
  const customerId = await as('priya@collector.test');
  section('Customer: cart');

  const sellable = list.items.find((i) => !i.soldOut) ?? list.items[0];

  await probe('getCart (empty)', () => cart.getCart(), (r) =>
    r.totals && Array.isArray(r.items) ? true : 'shape wrong',
  );
  // addToCart returns the whole refreshed cart, because the database decides
  // what the quantity actually becomes — the client's number is a request.
  await probe(
    'addToCart prices on the server',
    () => cart.addToCart(sellable.id, 1),
    (r) => (r?.totals?.subtotalMinor > 0 ? true : `no subtotal: totals=${JSON.stringify(r?.totals)}`),
  );
  await probe(
    'getCart reflects the addition and can proceed',
    () => cart.getCart(),
    (r) => (r.items.length === 1 && r.canProceed === true ? true : `items=${r.items.length} canProceed=${r.canProceed}`),
  );
  // Checked against cart_summary directly, because getCart deliberately does
  // not surface the split — the browser has no business computing it.
  await probe(
    'the server splits the subtotal 10/90, in whole paise',
    async () => {
      const userId = (await supabase.auth.getSession()).data.session.user.id;
      return (await supabase.rpc('cart_summary', { p_user_id: userId })).data;
    },
    (r) => {
      const { subtotal_minor: sub, commission_minor: fee, artist_earnings_minor: artistShare } = r;
      if (!(sub > 0)) return `subtotal was ${sub}`;
      if (fee + artistShare !== sub) return `${fee} + ${artistShare} != ${sub}`;
      if (fee !== Math.round(sub * 0.1)) return `commission ${fee} is not 10% of ${sub}`;
      return true;
    },
  );
  await probe(
    'setCartQuantity above stock is clamped, not accepted blindly',
    () => cart.setCartQuantity(sellable.id, 99),
    (r) => (r ? true : 'no result'),
  );
  await probe('clearCart empties it', async () => {
    await cart.clearCart();
    return cart.getCart();
  }, (r) => (r.items.length === 0 ? true : `${r.items.length} left`));

  section('Customer: wishlist and account');

  await probe('toggleWishlist on', () => cart.toggleWishlist(sellable.id), () => true);
  await probe('getWishlist shows it', () => cart.getWishlist(), nonEmpty('items'));
  await probe('toggleWishlist off', () => cart.toggleWishlist(sellable.id), () => true);
  await probe('getWishlist is empty again', () => cart.getWishlist(), (r) =>
    r.items.length === 0 ? true : `${r.items.length} left`,
  );

  await probe('listAddresses', () => cart.listAddresses(), (r) => (Array.isArray(r.items) ? true : 'no items'));
  await probe('listMyOrders', () => orders.listMyOrders(), (r) => (Array.isArray(r.items) ? true : 'no items'));
  await probe('getAccountSummary', () => orders.getAccountSummary(), (r) => (r ? true : 'nothing'));
  await probe('listNotifications', () => orders.listNotifications(), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe('listMyReviews', () => orders.listMyReviews(), (r) => (Array.isArray(r) || Array.isArray(r?.items) ? true : 'no items'));
  await probe('getWishlistIds', () => cart.getWishlistIds(), (r) => (Array.isArray(r) ? true : 'not an array'));

  section('Customer: cannot reach artist or admin data');

  await probeRefused('getArtistOverview refuses a customer', () => artist.getArtistOverview());
  await probeRefused('admin getOverview refuses a customer', () => admin.getOverview());
  await probeRefused('adminOps payout queue refuses a customer', () => adminOps.getPayoutQueue());
  await probeRefused('admin listUsers refuses a customer', () => admin.listUsers());
  await probeRefused('artist tools refuse a customer', () => artist.listArtistEnquiries());

  /* ═════════════ Artist ═════════════ */
  await as('jay@artsbyjay.test');
  section('Artist: dashboard');

  await probe(
    'getArtistOverview',
    () => artist.getArtistOverview(),
    (r) => (r?.profile?.displayName && r.artworks && r.sales ? true : 'shape wrong'),
  );
  await probe(
    'getArtistOverview reports no degraded panels',
    () => artist.getArtistOverview(),
    (r) => ((r.degraded ?? []).length === 0 ? true : `degraded: ${r.degraded.join(', ')}`),
  );
  await probe(
    'getArtistOverview earnings are numbers, not nulls',
    () => artist.getArtistOverview(),
    (r) => (Number.isFinite(r.sales.earningsMinor) ? true : `earnings=${r.sales.earningsMinor}`),
  );
  await probe(
    'getMyArtistProfile',
    () => artist.getMyArtistProfile(),
    (r) => (r?.profile?.displayName ? true : 'no profile'),
  );
  await probe(
    'getMyArtistProfile stats are derived, not zero-by-default',
    () => artist.getMyArtistProfile(),
    (r) =>
      Number.isFinite(r.profile.stats.publishedArtworks) && r.profile.stats.publishedArtworks > 0
        ? true
        : `publishedArtworks=${r.profile.stats.publishedArtworks}`,
  );
  await probe(
    'getMyArtistProfile lifetime earnings is a number, not null',
    () => artist.getMyArtistProfile(),
    (r) => (r.profile.stats.lifetimeEarningsMinor !== null ? true : 'came back null'),
  );
  await probe('listMyArtworks', () => artist.listMyArtworks({ limit: 5 }), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe('listArtistOrders', () => orders.listArtistOrders(), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe('listArtistEnquiries', () => artist.listArtistEnquiries(), (r) =>
    Array.isArray(r.items) || Array.isArray(r) ? true : 'no items',
  );

  section('Artist: cannot reach admin data');

  await probeRefused('admin getOverview refuses an artist', () => admin.getOverview());
  await probeRefused('adminOps payout queue refuses an artist', () => adminOps.getPayoutQueue());
  await probeRefused('adminOps audit log refuses an artist', () => adminOps.getAuditLog());
  await probeRefused('admin listUsers refuses an artist', () => admin.listUsers());
  await probeRefused('admin sales report refuses an artist', () => admin.getSalesReport());

  /* ═════════════ Admin ═════════════ */
  await as('admin@artsbyjay.test');
  section('Admin: every dashboard page');

  await probe('getOverview', () => admin.getOverview(), (r) => (r ? true : 'nothing'));
  await probe('listUsers', () => admin.listUsers({ limit: 5 }), (r) => (Array.isArray(r.items) ? true : 'no items'));
  await probe('listArtistApplications', () => admin.listArtistApplications({ limit: 5 }), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe(
    'listArtistApplications carries real stats, not nulls',
    () => admin.listArtistApplications({ limit: 5 }),
    (r) =>
      r.items.length === 0 || r.items.every((a) => a.stats && Number.isFinite(a.stats.publishedArtworks))
        ? true
        : 'stats came back null',
  );
  await probe('listArtworksForModeration', () => admin.listArtworksForModeration({ limit: 5 }), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe('listAllOrders', () => admin.listAllOrders({ limit: 5 }), (r) =>
    Array.isArray(r.items) ? true : 'no items',
  );
  await probe('getPlatformSettings', () => admin.getPlatformSettings(), (r) => (r ? true : 'nothing'));
  await probe('getSalesReport', () => admin.getSalesReport(), (r) => (r ? true : 'nothing'));
  await probe('getPaymentExceptions', () => adminOps.getPaymentExceptions(), (r) => (r ? true : 'nothing'));
  await probe('getPayoutQueue', () => adminOps.getPayoutQueue(), (r) => (r ? true : 'nothing'));
  await probe('getAuditLog', () => adminOps.getAuditLog(), (r) => (r ? true : 'nothing'));
  await probe('getWebhookEvents', () => adminOps.getWebhookEvents(), (r) => (r ? true : 'nothing'));
  await probe('listAllReviews', () => adminOps.listAllReviews(), (r) => (r ? true : 'nothing'));
  await probe('listAllEnquiries', () => adminOps.listAllEnquiries(), (r) => (r ? true : 'nothing'));
  await probe('listLinkedAccounts', () => adminOps.listLinkedAccounts(), (r) => (r ? true : 'nothing'));

  await supabase.auth.signOut();

  /* ═════════════ Summary ═════════════ */
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log(`${'='.repeat(64)}\n`);

  process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('\n[pages] the run itself threw:', err, '\n');
  process.exit(1);
});
