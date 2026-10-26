/**
 * Arts by Jay — cloud seed
 *
 * Populates the Supabase project with categories, artists and artwork, and
 * uploads generated artwork images to Supabase Storage.
 *
 * Nothing is written to local disk and nothing runs on your own
 * infrastructure: the images are generated in memory and streamed straight to
 * Supabase Storage.
 *
 * Needs the SERVICE ROLE key, because it creates auth users and writes rows
 * that RLS deliberately forbids from the browser. That key bypasses every
 * policy, so this script runs from your machine or CI and never ships to a
 * client.
 *
 * Usage:
 *   SUPABASE_URL=https://tdcdghuzasxkfdvactdz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node supabase/seed/seed.mjs
 *
 *   --reset   delete seeded rows first (never touches non-seed data)
 *   --no-images   skip image generation, for a fast structural seed
 */

import { createClient } from '@supabase/supabase-js';
import { generateArtwork, generateThumbnail } from '../../server/scripts/generateArtImage.js';
import { CATEGORIES, ARTISTS, ARTWORKS, CUSTOMERS } from '../../server/scripts/seedData.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';

const args = new Set(process.argv.slice(2));
const shouldReset = args.has('--reset');
const skipImages = args.has('--no-images');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n[seed] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.');
  console.error('[seed] Find them in your Supabase dashboard under Settings > API.');
  console.error('[seed] The service_role key bypasses Row Level Security — keep it out of');
  console.error('[seed] client code, Git and chat.\n');
  process.exit(1);
}

if (!SERVICE_KEY.startsWith('eyJ') && !SERVICE_KEY.startsWith('sb_')) {
  console.error('[seed] That does not look like a Supabase service_role key.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const log = (message) => console.log(`[seed] ${message}`);

const die = (context, error) => {
  console.error(`\n[seed] FAILED at ${context}:`);
  console.error(`       ${error?.message ?? error}`);
  if (error?.hint) console.error(`       hint: ${error.hint}`);
  if (error?.details) console.error(`       details: ${error.details}`);
  console.error('\n[seed] If this is a "relation does not exist" error, the migrations have not');
  console.error('[seed] been applied yet. Run:  npx supabase db push\n');
  process.exit(1);
};

const must = (result, context) => {
  if (result.error) die(context, result.error);
  return result.data;
};

const DIMENSIONS = {
  portrait: { width: 760, height: 1000 },
  landscape: { width: 1100, height: 740 },
  square: { width: 900, height: 900 },
};

const toMinor = (major) => Math.round(Number(major) * 100);

/* ─────────────────────────── Preflight ─────────────────────────── */

const preflight = async () => {
  const { error } = await db.from('platform_settings').select('key').limit(1);
  if (error) die('preflight (is the schema applied?)', error);

  const buckets = must(await db.storage.listBuckets(), 'listing storage buckets');
  const names = new Set(buckets.map((bucket) => bucket.name));

  for (const required of ['artworks', 'avatars']) {
    if (!names.has(required)) {
      die(
        'preflight',
        new Error(`Storage bucket "${required}" is missing. Migration 0004 creates it — has db push run?`),
      );
    }
  }

  log('schema and storage buckets look present');
};

/* ─────────────────────────── Reset ─────────────────────────── */

const reset = async () => {
  log('removing previously seeded data');

  // Order matters: children before parents, and orders are left alone because
  // deleting a paid order would destroy a financial record.
  const seedEmails = [
    ...ARTISTS.map((a) => a.email),
    ...CUSTOMERS.map((c) => c.email),
    'admin@artsbyjay.test',
  ];

  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const targets = (users?.users ?? []).filter((user) => seedEmails.includes(user.email));

  if (targets.length) {
    const orders = must(
      await db.from('orders').select('id').in('customer_id', targets.map((u) => u.id)),
      'checking for seeded orders',
    );

    if (orders.length) {
      console.error(`\n[seed] Refusing to reset: ${orders.length} order(s) belong to seeded accounts.`);
      console.error('[seed] Deleting them would destroy financial records. Remove them deliberately');
      console.error('[seed] first, or seed into a fresh project.\n');
      process.exit(1);
    }
  }

  await db.from('cart_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('wishlist_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('commission_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('artworks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Deleting the auth user cascades to profiles and artist_profiles.
  for (const user of targets) {
    await db.auth.admin.deleteUser(user.id);
  }

  log(`removed ${targets.length} seeded account(s) and their catalogue`);
};

/* ─────────────────────────── Users ─────────────────────────── */

/**
 * Creates (or finds) an auth user. `email_confirm: true` skips the
 * confirmation mail, which seeded accounts should not need.
 */
const upsertUser = async ({ email, name, role, artistName }) => {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: name,
      intent: role === 'artist' ? 'artist' : 'customer',
      artist_name: artistName ?? '',
    },
  });

  let userId = created?.user?.id;

  if (error) {
    if (!/already (been )?registered|already exists/i.test(error.message)) {
      die(`creating user ${email}`, error);
    }
    // Already there: find it and carry on, so the seed is re-runnable.
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users?.find((user) => user.email === email)?.id;
    if (!userId) die(`finding existing user ${email}`, new Error('not found after conflict'));
  }

  // The handle_new_user trigger sets the role, but only 'artist' and
  // 'customer' are self-assignable. An admin has to be promoted explicitly,
  // which is exactly the protection we want — so we do it here with the
  // service key rather than letting signup grant it.
  must(
    await db.from('profiles').update({ role, full_name: name }).eq('id', userId).select('id'),
    `setting role for ${email}`,
  );

  return userId;
};

/* ─────────────────────────── Images ─────────────────────────── */

const uploadArtworkImages = async (artwork, palette, seed, ownerId) => {
  if (skipImages) return [];

  const { width, height } = DIMENSIONS[artwork.orientation] ?? DIMENSIONS.portrait;
  const base = `${seed}-${artwork.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;

  const files = [
    { name: `${base}.png`, buffer: generateArtwork({ width, height, palette, seed }), label: artwork.title },
    { name: `${base}-thumb.png`, buffer: generateThumbnail({ width, height, palette, seed }), label: null },
    {
      name: `${base}-detail.png`,
      buffer: generateArtwork({ width, height, palette, seed: seed + 977 }),
      label: `${artwork.title} — detail`,
    },
  ];

  const uploaded = [];

  for (const file of files) {
    // Path must start with the owner's id to satisfy the storage policies.
    const path = `${ownerId}/seed/${file.name}`;

    const { error } = await db.storage
      .from('artworks')
      .upload(path, file.buffer, { contentType: 'image/png', upsert: true, cacheControl: '604800' });

    if (error) die(`uploading ${file.name}`, error);

    const { data } = db.storage.from('artworks').getPublicUrl(path);
    uploaded.push({ path, url: data.publicUrl, label: file.label });
  }

  const [full, thumb, detail] = uploaded;

  return [
    { url: full.url, thumbUrl: thumb.url, publicId: full.path, width, height, alt: artwork.title },
    { url: detail.url, thumbUrl: detail.url, publicId: detail.path, width, height, alt: detail.label },
  ];
};

const uploadProfileImages = async (slug, palette, seed, userId) => {
  if (skipImages) return { avatar_url: '', cover_url: '' };

  const avatar = generateArtwork({ width: 400, height: 400, palette, seed });
  const cover = generateArtwork({ width: 1600, height: 500, palette, seed: seed + 31 });

  const urls = {};

  for (const [key, buffer, name] of [
    ['avatar_url', avatar, `artist-${slug}.png`],
    ['cover_url', cover, `artist-${slug}-cover.png`],
  ]) {
    const path = `${userId}/${name}`;
    const { error } = await db.storage
      .from('avatars')
      .upload(path, buffer, { contentType: 'image/png', upsert: true, cacheControl: '604800' });

    if (error) die(`uploading ${name}`, error);

    const { data } = db.storage.from('avatars').getPublicUrl(path);
    urls[key] = data.publicUrl;
  }

  return urls;
};

/* ─────────────────────────── Seed steps ─────────────────────────── */

const seedCategories = async () => {
  const byKey = new Map();

  for (const parent of CATEGORIES) {
    const row = must(
      await db
        .from('categories')
        .insert({ name: parent.name, description: parent.description, is_featured: true, sort_order: byKey.size })
        .select('id, slug')
        .single(),
      `category ${parent.name}`,
    );
    byKey.set(parent.key, row);

    for (const child of parent.children) {
      const childRow = must(
        await db
          .from('categories')
          .insert({
            name: child.name,
            description: child.description,
            parent_id: row.id,
            sort_order: byKey.size,
          })
          .select('id, slug')
          .single(),
        `category ${child.name}`,
      );
      byKey.set(child.key, childRow);
    }
  }

  log(`created ${byKey.size} categories`);
  return byKey;
};

const seedAdmin = async () => {
  const email = process.env.ADMIN_EMAIL ?? 'admin@artsbyjay.test';
  const id = await upsertUser({ email, name: 'Arts by Jay Admin', role: 'admin' });
  log(`admin ready: ${email}`);
  return { id, email };
};

const seedArtists = async (adminId) => {
  const byKey = new Map();
  let seed = 101;

  for (const artist of ARTISTS) {
    const userId = await upsertUser({
      email: artist.email,
      name: artist.name,
      role: 'artist',
      artistName: artist.displayName,
    });

    const images = await uploadProfileImages(artist.key, artist.palette, seed, userId);
    seed += 13;

    // The trigger already made a pending profile; approve and fill it in.
    const profile = must(
      await db
        .from('artist_profiles')
        .update({
          display_name: artist.displayName,
          bio: artist.bio,
          statement: artist.statement,
          location: artist.location,
          specialities: artist.specialities,
          accepts_commissions: artist.acceptsCommissions,
          commission_note: artist.commissionNote,
          is_featured: artist.featured,
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminId,
          ...images,
        })
        .eq('user_id', userId)
        .select('id, slug, display_name')
        .single(),
      `artist profile ${artist.displayName}`,
    );

    byKey.set(artist.key, { userId, profile, palette: artist.palette });
  }

  log(`created ${byKey.size} approved artists`);
  return byKey;
};

const seedArtworks = async (artists, categories, adminId) => {
  let created = 0;
  let seed = 7001;

  for (const item of ARTWORKS) {
    const artist = artists.get(item.artist);
    const category = categories.get(item.category);

    if (!artist || !category) {
      log(`skipped "${item.title}" — unknown artist or category`);
      continue;
    }

    const images = await uploadArtworkImages(item, artist.palette, seed, artist.userId);
    seed += 211;

    const status = item.status ?? 'published';
    const isDigital = item.type === 'digital';
    const publishedAt =
      status === 'published' ? new Date(Date.now() - created * 86400000).toISOString() : null;

    must(
      await db
        .from('artworks')
        .insert({
          title: item.title,
          description: item.description,
          story: item.story ?? '',
          artist_id: artist.profile.id,
          owner_id: artist.userId,
          category_id: category.id,
          style: item.style ?? '',
          medium: item.medium ?? '',
          year: item.year,
          tags: item.tags ?? [],
          type: item.type,
          price_minor: toMinor(item.price),
          currency: 'INR',
          stock: item.stock ?? (item.type === 'original' ? 1 : 10),
          allow_backorder: false,
          width_cm: item.dimensions?.width ?? null,
          height_cm: item.dimensions?.height ?? null,
          depth_cm: item.dimensions?.depth ?? null,
          orientation: item.orientation,
          is_framed: Boolean(item.isFramed),
          images,
          ships_from: item.shipsFrom ?? '',
          processing_days: item.type === 'commission' ? 60 : 4,
          shipping_flat_minor: toMinor(item.flatRate ?? 0),
          is_digital_delivery: isDigital,
          status,
          published_at: publishedAt,
          is_featured: Boolean(item.featured),
          in_virtual_gallery: status === 'published',
          ...(status === 'published'
            ? { moderated_at: new Date().toISOString(), moderated_by: adminId, moderation_note: 'Approved during seeding.' }
            : {}),
        })
        .select('id')
        .single(),
      `artwork ${item.title}`,
    );

    created += 1;
    if (created % 5 === 0) log(`  ${created}/${ARTWORKS.length} artworks`);
  }

  log(`created ${created} artworks`);
};

const seedCustomers = async () => {
  const ids = [];

  for (const customer of CUSTOMERS) {
    const id = await upsertUser({ email: customer.email, name: customer.name, role: 'customer' });

    must(
      await db
        .from('addresses')
        .insert({
          user_id: id,
          label: 'Home',
          full_name: customer.name,
          phone: '+91 98200 00000',
          line1: '14 Shanti Apartments',
          line2: 'Off Linking Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          postal_code: '400050',
          country: 'India',
          is_default: true,
        })
        .select('id'),
      `address for ${customer.email}`,
    );

    ids.push(id);
  }

  log(`created ${ids.length} customers`);
  return ids;
};

/* ─────────────────────────── Run ─────────────────────────── */

const run = async () => {
  console.log(`\nArts by Jay — seeding ${SUPABASE_URL}`);
  console.log(`Images: ${skipImages ? 'skipped' : 'generated and uploaded to Supabase Storage'}\n`);

  await preflight();
  if (shouldReset) await reset();

  const categories = await seedCategories();
  const admin = await seedAdmin();
  const artists = await seedArtists(admin.id);
  await seedArtworks(artists, categories, admin.id);
  await seedCustomers();

  // Make the bootstrap email match the admin, so the rule is coherent if
  // someone later recreates the account.
  await db.from('platform_settings').update({ value: admin.email }).eq('key', 'admin_bootstrap_email');

  console.log('\n[seed] Done. Sign-in details (development data only):');
  console.log(`  admin     ${admin.email}   ${SEED_PASSWORD}`);
  ARTISTS.forEach((artist) => console.log(`  artist    ${artist.email}   ${SEED_PASSWORD}`));
  CUSTOMERS.forEach((customer) => console.log(`  customer  ${customer.email}   ${SEED_PASSWORD}`));
  console.log('\n[seed] Change these passwords before letting anyone else near the project.\n');
};

run().catch((err) => {
  console.error('\n[seed] unexpected failure:', err);
  process.exit(1);
});
