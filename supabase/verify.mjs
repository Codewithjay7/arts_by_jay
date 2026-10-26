/**
 * Security verification against the LIVE Supabase project.
 *
 * This does not check that policies exist — `apply.mjs --verify` counts those.
 * It checks that they WORK, by making real requests as a real anonymous
 * visitor, a real customer and a real artist, and asserting that each one is
 * refused exactly where it should be.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node supabase/verify.mjs
 */

import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../server/.env') });

const URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';

if (!URL || !PUBLISHABLE || !SECRET) {
  console.error('[verify] need SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const anonOptions = { auth: { persistSession: false, autoRefreshToken: false } };

const anon = createClient(URL, PUBLISHABLE, anonOptions);
const service = createClient(URL, SECRET, anonOptions);

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (title) => console.log(`\n── ${title} ──`);

const signIn = async (email) => {
  const client = createClient(URL, PUBLISHABLE, anonOptions);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { client, userId: data.user.id };
};

const run = async () => {
  console.log(`\nArts by Jay — live security verification\n${URL}`);

  /* ───────────────────── Anonymous visitor ───────────────────── */

  section('Anonymous visitor (publishable key)');

  const published = await anon.from('artworks').select('id, title, status').limit(50);
  check('can read the published catalogue', !published.error && published.data.length > 0,
    published.error?.message ?? `${published.data?.length} rows`);
  check('sees ONLY published rows',
    (published.data ?? []).every((row) => row.status === 'published'),
    [...new Set((published.data ?? []).map((r) => r.status))].join(','));

  // The seed deliberately includes a draft and a pending piece.
  const allRows = await service.from('artworks').select('id, status');
  const hidden = (allRows.data ?? []).filter((r) => r.status !== 'published');
  const visibleIds = new Set((published.data ?? []).map((r) => r.id));
  check(`drafts and pending work are hidden (${hidden.length} such rows exist)`,
    hidden.length > 0 && hidden.every((row) => !visibleIds.has(row.id)));

  const profiles = await anon.from('profiles').select('id, email').limit(5);
  check('CANNOT read anyone\'s profile', (profiles.data ?? []).length === 0,
    `${profiles.data?.length ?? 0} rows leaked`);

  const orders = await anon.from('orders').select('id').limit(5);
  check('CANNOT read orders', (orders.data ?? []).length === 0);

  const payments = await anon.from('payments').select('id').limit(5);
  check('CANNOT read payments', (payments.data ?? []).length === 0);

  const audit = await anon.from('audit_logs').select('id').limit(5);
  check('CANNOT read audit logs', (audit.data ?? []).length === 0);

  const bootstrap = await anon.from('platform_settings').select('key, value');
  const keys = (bootstrap.data ?? []).map((r) => r.key);
  check('can read the commission rate (needed by the UI)', keys.includes('commission_percent'));
  check('CANNOT read the admin bootstrap email', !keys.includes('admin_bootstrap_email'),
    keys.join(','));

  const insertArt = await anon.from('artworks').insert({
    title: 'Injected', description: 'x', artist_id: hidden[0]?.id ?? null,
    owner_id: hidden[0]?.id ?? null, category_id: hidden[0]?.id ?? null, price_minor: 1,
  });
  check('CANNOT insert an artwork', Boolean(insertArt.error), 'insert succeeded');

  const anonRpc = await anon.rpc('settle_paid_order', {
    p_order_id: '00000000-0000-0000-0000-000000000000',
    p_payment_id: '00000000-0000-0000-0000-000000000000',
  });
  check('CANNOT call settle_paid_order', Boolean(anonRpc.error), 'the money function was callable');

  /* ───────────────────── Customer ───────────────────── */

  section('Signed-in customer');

  const priya = await signIn('priya@collector.test');
  const arjun = await signIn('arjun@collector.test');

  const ownProfile = await priya.client.from('profiles').select('id, email, role').eq('id', priya.userId);
  check('can read their own profile', (ownProfile.data ?? []).length === 1);
  check('their role is customer', ownProfile.data?.[0]?.role === 'customer');

  const otherProfile = await priya.client.from('profiles').select('id').eq('id', arjun.userId);
  check('CANNOT read another customer\'s profile', (otherProfile.data ?? []).length === 0);

  const escalate = await priya.client.from('profiles').update({ role: 'admin' }).eq('id', priya.userId);
  check('CANNOT promote themselves to admin', Boolean(escalate.error),
    escalate.error ? '' : 'the update was accepted');

  const recheckRole = await service.from('profiles').select('role').eq('id', priya.userId).single();
  check('their role is still customer afterwards', recheckRole.data?.role === 'customer',
    recheckRole.data?.role);

  const activate = await priya.client.from('profiles').update({ is_active: false }).eq('id', priya.userId);
  check('CANNOT change their own account status', Boolean(activate.error));

  // Cart, through the RPC that enforces availability server-side.
  const buyable = (published.data ?? []).find((r) => r.status === 'published');
  const addCart = await priya.client.rpc('add_to_cart', { p_artwork_id: buyable.id, p_quantity: 3 });
  check('can add to their cart via the RPC', !addCart.error, addCart.error?.message);
  check('the cart summary is priced by the database',
    typeof addCart.data?.subtotal_minor === 'number' && addCart.data.subtotal_minor > 0,
    JSON.stringify(addCart.data).slice(0, 160));

  const originals = await service
    .from('artworks')
    .select('id, title, type, stock')
    .eq('type', 'original')
    .eq('status', 'published')
    .limit(1);

  if (originals.data?.length) {
    const original = originals.data[0];
    const addOriginal = await priya.client.rpc('add_to_cart', { p_artwork_id: original.id, p_quantity: 9 });
    const line = await service
      .from('cart_items')
      .select('quantity, cart:carts!inner(user_id)')
      .eq('artwork_id', original.id);
    const mine = (line.data ?? []).find((r) => r.cart?.user_id === priya.userId);
    check('an original is capped at quantity 1 regardless of what was asked',
      !addOriginal.error && mine?.quantity === 1, `quantity ${mine?.quantity}`);
  }

  const soldOut = await service
    .from('artworks')
    .select('id, title')
    .eq('status', 'published')
    .lte('stock', 0)
    .eq('allow_backorder', false)
    .eq('is_digital_delivery', false)
    .limit(1);

  if (soldOut.data?.length) {
    const refused = await priya.client.rpc('add_to_cart', { p_artwork_id: soldOut.data[0].id, p_quantity: 1 });
    check('a sold-out piece is refused by the database', Boolean(refused.error),
      refused.error ? '' : 'it was added');
  }

  // Only meaningful once Priya actually has something in her cart, which the
  // add_to_cart calls above arrange.
  const foreignCart = await arjun.client.from('cart_items').select('id');
  const allCartRows = await service.from('cart_items').select('id');
  check('one customer cannot see another\'s cart items',
    (allCartRows.data ?? []).length > 0 && (foreignCart.data ?? []).length === 0,
    `arjun saw ${foreignCart.data?.length}, total is ${allCartRows.data?.length}`);

  const reviewAttempt = await priya.client.from('reviews').insert({
    artwork_id: buyable.id, author_id: priya.userId,
    order_id: '00000000-0000-0000-0000-000000000000', rating: 5, body: 'Never bought it.',
  });
  check('CANNOT review without a delivered order', Boolean(reviewAttempt.error));

  /* ───────────────────── Artist ───────────────────── */

  section('Signed-in artist');

  const jay = await signIn('jay@artsbyjay.test');
  const anaya = await signIn('anaya@artsbyjay.test');

  const jayArt = await service
    .from('artworks')
    .select('id, title, status, owner_id, is_featured')
    .eq('owner_id', jay.userId)
    .limit(20);

  /**
   * The target must be UNPUBLISHED and UNFEATURED, otherwise "set status to
   * published" and "set is_featured to true" are no-ops — the guard trigger
   * only fires on an actual change, so an already-published piece would make
   * these assertions pass for the wrong reason. An earlier version of this
   * file had exactly that bug and reported a false failure.
   */
  let jayDraft = (jayArt.data ?? []).find((r) => r.status !== 'published' && !r.is_featured);

  if (!jayDraft) {
    // Create a draft to test against, so the suite does not depend on the
    // seed happening to contain one.
    const category = await service.from('categories').select('id').limit(1).single();
    const profile = await service
      .from('artist_profiles')
      .select('id')
      .eq('user_id', jay.userId)
      .single();

    const made = await service
      .from('artworks')
      .insert({
        title: `Verification Draft ${Date.now()}`,
        description: 'Created by the security verification run.',
        artist_id: profile.data.id,
        owner_id: jay.userId,
        category_id: category.data.id,
        type: 'print',
        price_minor: 100000,
        stock: 3,
        status: 'draft',
        is_featured: false,
      })
      .select('id, title, status, is_featured')
      .single();

    jayDraft = made.data;
  }

  check('a test target exists that is neither published nor featured',
    Boolean(jayDraft) && jayDraft.status !== 'published' && !jayDraft.is_featured,
    `status ${jayDraft?.status}, featured ${jayDraft?.is_featured}`);

  // Re-count AFTER any draft was created above, or the comparison is against
  // a stale snapshot.
  const trueCount = await service.from('artworks').select('id').eq('owner_id', jay.userId);
  const ownListings = await jay.client.from('artworks').select('id, status').eq('owner_id', jay.userId);
  check('an artist sees their own listings at every status',
    (ownListings.data ?? []).length === (trueCount.data ?? []).length,
    `${ownListings.data?.length} of ${trueCount.data?.length}`);

  const editOwn = await jay.client
    .from('artworks')
    .update({ description: `Edited by verification at ${new Date().toISOString()}` })
    .eq('id', jayDraft.id);
  check('can edit their own listing', !editOwn.error, editOwn.error?.message);

  const selfPublish = await jay.client
    .from('artworks')
    .update({ status: 'published' })
    .eq('id', jayDraft.id);
  check('CANNOT publish their own work (curation is admin-only)',
    Boolean(selfPublish.error), selfPublish.error ? '' : 'it published itself');

  const selfFeature = await jay.client.from('artworks').update({ is_featured: true }).eq('id', jayDraft.id);
  check('CANNOT feature their own work', Boolean(selfFeature.error));

  const fakeSales = await jay.client.from('artworks').update({ units_sold: 9999 }).eq('id', jayDraft.id);
  check('CANNOT inflate their own sales counter', Boolean(fakeSales.error));

  const crossEdit = await anaya.client
    .from('artworks')
    .update({ title: 'Hijacked' })
    .eq('id', jayDraft.id)
    .select('id');
  check('CANNOT edit another artist\'s listing',
    Boolean(crossEdit.error) || (crossEdit.data ?? []).length === 0,
    `${crossEdit.data?.length ?? 0} rows changed`);

  // Must be a DIFFERENT value: Jay is already approved, so writing 'approved'
  // would be a no-op and the guard would never fire.
  const selfApprove = await jay.client
    .from('artist_profiles')
    .update({ status: 'suspended' })
    .eq('user_id', jay.userId);
  check('CANNOT change their own approval status', Boolean(selfApprove.error),
    selfApprove.error ? '' : 'an artist suspended/approved themselves');

  const stillApproved = await service
    .from('artist_profiles')
    .select('status')
    .eq('user_id', jay.userId)
    .single();
  check('their approval status is unchanged afterwards', stillApproved.data?.status === 'approved',
    stillApproved.data?.status);

  const selfFeatureArtist = await jay.client
    .from('artist_profiles')
    .update({ review_note: 'I approve of myself' })
    .eq('user_id', jay.userId);
  check('CANNOT write their own curator review note', Boolean(selfFeatureArtist.error));

  const linkedAccount = await jay.client
    .from('artist_accounts')
    .insert({ artist_id: jayDraft.id, user_id: jay.userId, provider_account_id: 'acc_attacker' });
  check('CANNOT create their own payout linked account', Boolean(linkedAccount.error),
    'an artist could point payouts at any account');

  const artistRpc = await jay.client.rpc('record_settlement', {
    p_order_item_id: '00000000-0000-0000-0000-000000000000',
    p_out_of_band_reference: 'self-paid',
  });
  check('CANNOT call record_settlement to pay themselves', Boolean(artistRpc.error));

  const confirmDelivery = await jay.client.rpc('confirm_delivery', {
    p_order_item_id: '00000000-0000-0000-0000-000000000000',
    p_source: 'admin',
  });
  check('CANNOT confirm delivery themselves', Boolean(confirmDelivery.error));

  /* ───────────────────── Commission snapshot ───────────────────── */

  section('Commission snapshot immutability');

  const rate = await service.from('platform_settings').select('value').eq('key', 'commission_percent').single();
  check('the configured rate is 10%', rate.data?.value === '10', rate.data?.value);

  // Build a real order with the service role, then try to rewrite its
  // commission — which the trigger must refuse even for the service role.
  const custRow = await service.from('profiles').select('id, email').eq('email', 'priya@collector.test').single();
  const artRow = await service
    .from('artworks')
    .select('id, title, slug, artist_id, owner_id, price_minor')
    .eq('status', 'published')
    .limit(1)
    .single();

  const orderNumber = await service.rpc('generate_order_number');
  const madeOrder = await service
    .from('orders')
    .insert({
      order_number: orderNumber.data,
      customer_id: custRow.data.id,
      customer_email: custRow.data.email,
      subtotal_minor: 200000,
      shipping_total_minor: 0,
      discount_minor: 0,
      total_minor: 200000,
      shipping_address: { full_name: 'Verify', phone: '1', line1: '1', city: 'x', state: 'y', postal_code: '1', country: 'India' },
      status: 'pending_payment',
    })
    .select('id')
    .single();

  check('an order can be created by trusted server code', !madeOrder.error, madeOrder.error?.message);

  const madeItem = await service
    .from('order_items')
    .insert({
      order_id: madeOrder.data.id,
      artwork_id: artRow.data.id,
      artist_id: artRow.data.artist_id,
      artist_user_id: artRow.data.owner_id,
      title: artRow.data.title,
      quantity: 1,
      unit_price_minor: 200000,
      line_total_minor: 200000,
      shipping_minor: 0,
      commission_rate_percent: 10,
      commission_basis_minor: 200000,
      commission_minor: 20000,
      artist_earnings_minor: 180000,
    })
    .select('id, commission_minor, artist_earnings_minor')
    .single();

  check('the worked example stores as 200000 -> 20000 / 180000',
    madeItem.data?.commission_minor === 20000 && madeItem.data?.artist_earnings_minor === 180000,
    madeItem.error?.message);

  const rewrite = await service
    .from('order_items')
    .update({ commission_rate_percent: 50, commission_minor: 100000, artist_earnings_minor: 100000 })
    .eq('id', madeItem.data?.id);
  check('the commission snapshot CANNOT be rewritten, even by the service role',
    Boolean(rewrite.error), rewrite.error ? '' : 'the snapshot was overwritten');

  const badSplit = await service.from('order_items').insert({
    order_id: madeOrder.data.id,
    artwork_id: artRow.data.id,
    artist_id: artRow.data.artist_id,
    artist_user_id: artRow.data.owner_id,
    title: 'Bad split',
    quantity: 1,
    unit_price_minor: 100000,
    line_total_minor: 100000,
    shipping_minor: 0,
    commission_rate_percent: 10,
    commission_basis_minor: 100000,
    // Deliberately does not add up.
    commission_minor: 10000,
    artist_earnings_minor: 50000,
  });
  check('a split that does not reconcile is rejected by a CHECK constraint', Boolean(badSplit.error));

  // Clean up the verification order so it never pollutes reports.
  await service.from('order_items').delete().eq('order_id', madeOrder.data.id);
  await service.from('orders').delete().eq('id', madeOrder.data.id);

  /* ───────────────────── Pricing & gallery ───────────────────── */

  section('Server-side pricing and gallery');

  const priced = await service.rpc('price_cart', { p_user_id: priya.userId });
  check('price_cart returns priced lines', !priced.error && (priced.data ?? []).length > 0,
    priced.error?.message);

  const anyLine = (priced.data ?? []).find((l) => l.line_total_minor);
  if (anyLine) {
    const expected = Math.round((anyLine.commission_basis_minor * 10) / 100);
    check('commission is 10% of the basis, computed in SQL',
      anyLine.commission_minor === expected,
      `${anyLine.commission_minor} vs ${expected}`);
    check('commission + earnings = basis exactly',
      anyLine.commission_minor + anyLine.artist_earnings_minor === anyLine.commission_basis_minor);
    check('the basis EXCLUDES shipping',
      anyLine.commission_basis_minor === anyLine.line_total_minor,
      `basis ${anyLine.commission_basis_minor}, line ${anyLine.line_total_minor}, ship ${anyLine.shipping_minor}`);
  }

  const gallery = await anon.rpc('gallery_layout', { p_limit: 24 });
  check('the gallery layout is available anonymously', !gallery.error && gallery.data?.total > 0,
    gallery.error?.message ?? `${gallery.data?.total} pieces`);

  const sides = new Set((gallery.data?.artworks ?? []).map((a) => a.gallery.side));
  check('artwork hangs on BOTH walls', sides.has('left') && sides.has('right'), [...sides].join(','));
  check('more than one room', gallery.data?.layout?.totalRooms > 1, `${gallery.data?.layout?.totalRooms}`);

  const galleryIds = new Set((gallery.data?.artworks ?? []).map((a) => a.id));
  const shopIds = new Set((published.data ?? []).map((a) => a.id));
  check('every gallery piece is a real shop listing',
    [...galleryIds].every((id) => shopIds.has(id)));

  /* ───────────────────── Storage ───────────────────── */

  section('Storage');

  const buckets = await service.storage.listBuckets();
  const bucketMap = new Map((buckets.data ?? []).map((b) => [b.name, b]));
  check('artworks bucket is public', bucketMap.get('artworks')?.public === true);
  check('avatars bucket is public', bucketMap.get('avatars')?.public === true);
  check('commission-references bucket is PRIVATE',
    bucketMap.get('commission-references')?.public === false,
    'customer photos would be world-readable');

  const sample = await service.from('artworks').select('images').not('images', 'eq', '[]').limit(1).single();
  const imageUrl = sample.data?.images?.[0]?.url;

  if (imageUrl) {
    const response = await fetch(imageUrl);
    check('a seeded artwork image is publicly fetchable',
      response.ok && (response.headers.get('content-type') ?? '').startsWith('image/'),
      `HTTP ${response.status} ${response.headers.get('content-type')}`);
  }

  const foreignUpload = await anaya.client.storage
    .from('artworks')
    .upload(`${jay.userId}/intrusion.png`, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  check('an artist CANNOT upload into another artist\'s folder', Boolean(foreignUpload.error));

  /* ─────────── Regressions these checks once failed to catch ─────────── */

  // Every check in this section exists because a bug reached the live site
  // while the suite above was fully green. They are plain reads performed as
  // an ordinary signed-in user, which is precisely the thing the rest of the
  // suite skipped: it set rows up with the service role and asserted on
  // policy INTENT, so a query that cannot execute at all still "passed".

  section('Regression: readable as an ordinary user');

  // Two permissive SELECT policies referred to each other's tables
  // (orders -> order_items -> orders). Postgres OR-evaluates every policy for
  // the command, not just the matching one, so ANY authenticated select on
  // `orders` aborted with 42P17 "infinite recursion detected in policy".
  // No customer could open their order history and no artist could see a
  // sale. Fixed in 0011 with SECURITY DEFINER membership helpers.
  const recursionProne = ['orders', 'order_items', 'shipments', 'refunds', 'delivery_confirmations'];
  for (const table of recursionProne) {
    const read = await priya.client.from(table).select('id').limit(1);
    check(
      `a customer can SELECT ${table} without policy recursion`,
      read.error?.code !== '42P17',
      read.error ? `${read.error.code}: ${read.error.message}` : '',
    );
  }

  const artistOrders = await jay.client.from('orders').select('id').limit(1);
  check(
    'an artist can SELECT orders without policy recursion',
    artistOrders.error?.code !== '42P17',
    artistOrders.error ? `${artistOrders.error.code}: ${artistOrders.error.message}` : '',
  );

  // The membership helpers must not become a way to ask about someone else:
  // they read auth.uid() internally and take no user-id argument, so there is
  // no parameter to point at another person.
  const probeOther = await priya.client.rpc('order_is_mine', {
    p_order_id: '00000000-0000-0000-0000-000000000000',
  });
  check('order_is_mine answers only about the caller', probeOther.error === null && probeOther.data === false);

  // The artwork detail page and the gallery zoom panel each built a select
  // that embedded artist_profiles TWICE (the shared card columns already had
  // it, and the detail query appended a richer one). PostgREST rejects the
  // whole query: 42712 'table name "artworks_artist_1" specified more than
  // once'. Both pages showed "That did not load".
  const detailSelect = `
    id, title, slug, price_minor, images, status,
    category:categories ( id, name, slug ),
    description, story, year, tags,
    artist:artist_profiles ( id, display_name, slug, bio, avatar_url, location,
                             accepts_commissions, commission_note )
  `;
  const detailRead = await anon.from('artworks').select(detailSelect).eq('status', 'published').limit(1);
  check(
    'the artwork detail select resolves (no duplicated embed)',
    detailRead.error === null && (detailRead.data ?? []).length === 1,
    detailRead.error ? `${detailRead.error.code}: ${detailRead.error.message}` : '',
  );
  check(
    'the detail select returns the FULL artist embed',
    Boolean(detailRead.data?.[0]?.artist && 'commission_note' in detailRead.data[0].artist),
  );

  // A healthy cart once reported can_proceed: null, because
  // `bool_or(...) filter (...)` over zero rows is NULL rather than false — so
  // the checkout button was disabled for carts with nothing wrong. Fixed in
  // 0010. The value must be a real boolean, never null.
  const summary = await priya.client.rpc('cart_summary', { p_user_id: priya.userId });
  check(
    'cart_summary.can_proceed is a boolean, never null',
    summary.error === null && typeof summary.data?.can_proceed === 'boolean',
    summary.error ? summary.error.message : `got ${JSON.stringify(summary.data?.can_proceed)}`,
  );

  /* ───────────────────── Clean up ───────────────────── */

  // Remove anything this run created, so repeated runs do not accumulate
  // junk listings or leave a stray cart behind.
  await service.from('artworks').delete().like('title', 'Verification Draft %');
  await service.from('cart_items').delete().in(
    'cart_id',
    (await service.from('carts').select('id').eq('user_id', priya.userId)).data?.map((c) => c.id) ?? [],
  );
  await service.storage.from('artworks').remove([`${jay.userId}/intrusion.png`]).catch(() => {});

  /* ───────────────────── Summary ───────────────────── */

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((entry) => console.log(`    - ${entry}`));
  }
  console.log(`${'='.repeat(64)}\n`);

  process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('\n[verify] the run itself threw:', err);
  process.exit(1);
});
