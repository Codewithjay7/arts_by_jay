import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import {
  User,
  ArtistProfile,
  Artwork,
  Category,
  Cart,
  Wishlist,
  Order,
  Payment,
  Review,
  CommissionRequest,
  Notification,
  RefreshToken,
  Address,
} from '../src/models/index.js';
import { UPLOAD_ROOT } from '../src/services/storage.js';
import { toMinor } from '../src/utils/money.js';
import { generateArtwork, generateThumbnail } from './generateArtImage.js';
import { CATEGORIES, ARTISTS, ARTWORKS, CUSTOMERS } from './seedData.js';

const SEED_PASSWORD = 'ArtsByJay2025';

const DIMENSIONS_BY_ORIENTATION = {
  portrait: { width: 760, height: 1000 },
  landscape: { width: 1100, height: 740 },
  square: { width: 900, height: 900 },
};

const log = (message) => console.log(`[seed] ${message}`);

/* ───────────────────────── Image generation ───────────────────────── */

const writeArtworkImages = async (artwork, artistPalette, seed) => {
  const folder = path.join(UPLOAD_ROOT, 'seed');
  await fs.mkdir(folder, { recursive: true });

  const { width, height } = DIMENSIONS_BY_ORIENTATION[artwork.orientation] ?? DIMENSIONS_BY_ORIENTATION.portrait;
  const base = `${seed}-${artwork.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;

  const full = generateArtwork({ width, height, palette: artistPalette, seed });
  const thumb = generateThumbnail({ width, height, palette: artistPalette, seed });

  const fullName = `${base}.png`;
  const thumbName = `${base}-thumb.png`;

  await fs.writeFile(path.join(folder, fullName), full);
  await fs.writeFile(path.join(folder, thumbName), thumb);

  // A second "detail" view, generated from a shifted seed.
  const detail = generateArtwork({ width, height, palette: artistPalette, seed: seed + 977 });
  const detailName = `${base}-detail.png`;
  await fs.writeFile(path.join(folder, detailName), detail);

  const url = (name) => `${env.publicApiUrl}/uploads/seed/${name}`;

  return [
    {
      url: url(fullName),
      thumbUrl: url(thumbName),
      publicId: `seed/${fullName}`,
      width,
      height,
      alt: artwork.title,
    },
    {
      url: url(detailName),
      thumbUrl: url(detailName),
      publicId: `seed/${detailName}`,
      width,
      height,
      alt: `${artwork.title} — detail`,
    },
  ];
};

const writeProfileImage = async (slug, palette, seed) => {
  const folder = path.join(UPLOAD_ROOT, 'seed');
  await fs.mkdir(folder, { recursive: true });

  const avatar = generateArtwork({ width: 400, height: 400, palette, seed });
  const cover = generateArtwork({ width: 1600, height: 500, palette, seed: seed + 31 });

  await fs.writeFile(path.join(folder, `artist-${slug}.png`), avatar);
  await fs.writeFile(path.join(folder, `artist-${slug}-cover.png`), cover);

  return {
    avatarUrl: `${env.publicApiUrl}/uploads/seed/artist-${slug}.png`,
    coverUrl: `${env.publicApiUrl}/uploads/seed/artist-${slug}-cover.png`,
  };
};

/* ─────────────────────────── Seeding steps ─────────────────────────── */

const clearDatabase = async () => {
  await Promise.all([
    User.deleteMany({}),
    ArtistProfile.deleteMany({}),
    Artwork.deleteMany({}),
    Category.deleteMany({}),
    Cart.deleteMany({}),
    Wishlist.deleteMany({}),
    Order.deleteMany({}),
    Payment.deleteMany({}),
    Review.deleteMany({}),
    CommissionRequest.deleteMany({}),
    Notification.deleteMany({}),
    RefreshToken.deleteMany({}),
    Address.deleteMany({}),
  ]);
  log('cleared existing collections');
};

const seedCategories = async () => {
  const byKey = new Map();

  for (const parent of CATEGORIES) {
    // eslint-disable-next-line no-await-in-loop
    const created = await Category.create({
      name: parent.name,
      description: parent.description,
      isFeatured: true,
      sortOrder: byKey.size,
    });
    byKey.set(parent.key, created);

    for (const child of parent.children) {
      // eslint-disable-next-line no-await-in-loop
      const createdChild = await Category.create({
        name: child.name,
        description: child.description,
        parent: created._id,
        sortOrder: byKey.size,
      });
      byKey.set(child.key, createdChild);
    }
  }

  log(`created ${byKey.size} categories`);
  return byKey;
};

const createUser = async ({ name, email, role }) => {
  const user = new User({ name, email, role });
  await user.setPassword(SEED_PASSWORD);
  await user.save();

  await Promise.all([
    Cart.create({ user: user._id, items: [] }),
    Wishlist.create({ user: user._id, artworks: [] }),
  ]);

  return user;
};

const seedAdmin = async () => {
  const email = env.auth.adminBootstrapEmail || 'admin@artsbyjay.test';
  const admin = await createUser({ name: 'Arts by Jay Admin', email, role: 'admin' });
  log(`created admin ${email}`);
  return admin;
};

const seedArtists = async (adminId) => {
  const byKey = new Map();
  let seed = 101;

  for (const artist of ARTISTS) {
    // eslint-disable-next-line no-await-in-loop
    const user = await createUser({ name: artist.name, email: artist.email, role: 'artist' });

    // eslint-disable-next-line no-await-in-loop
    const images = await writeProfileImage(artist.key, artist.palette, seed);
    seed += 13;

    // eslint-disable-next-line no-await-in-loop
    const profile = await ArtistProfile.create({
      user: user._id,
      displayName: artist.displayName,
      bio: artist.bio,
      statement: artist.statement,
      location: artist.location,
      specialities: artist.specialities,
      acceptsCommissions: artist.acceptsCommissions,
      commissionNote: artist.commissionNote,
      isFeatured: artist.featured,
      // Seeded artists arrive already approved so the storefront is populated.
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: adminId,
      ...images,
    });

    byKey.set(artist.key, { user, profile, palette: artist.palette });
  }

  log(`created ${byKey.size} artists`);
  return byKey;
};

const seedArtworks = async (artistsByKey, categoriesByKey, adminId) => {
  const created = [];
  let seed = 7001;

  for (const item of ARTWORKS) {
    const artist = artistsByKey.get(item.artist);
    const category = categoriesByKey.get(item.category);

    if (!artist || !category) {
      log(`skipped "${item.title}" — unknown artist or category`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const images = await writeArtworkImages(item, artist.palette, seed);
    seed += 211;

    const status = item.status ?? 'published';
    const isDigital = item.type === 'digital';

    // eslint-disable-next-line no-await-in-loop
    const artwork = await Artwork.create({
      title: item.title,
      description: item.description,
      story: item.story ?? '',
      artist: artist.profile._id,
      owner: artist.user._id,
      category: category._id,
      style: item.style ?? '',
      medium: item.medium ?? '',
      year: item.year,
      tags: item.tags ?? [],
      type: item.type,
      priceMinor: toMinor(item.price),
      currency: env.payments.currency,
      stock: item.stock ?? (item.type === 'original' ? 1 : 10),
      allowBackorder: false,
      dimensions: { ...item.dimensions, unit: 'cm' },
      orientation: item.orientation,
      isFramed: Boolean(item.isFramed),
      images,
      shipping: {
        shipsFrom: item.shipsFrom ?? '',
        processingDays: item.type === 'commission' ? 60 : 4,
        flatRateMinor: toMinor(item.flatRate ?? 0),
        isDigitalDelivery: isDigital,
      },
      status,
      publishedAt: status === 'published' ? new Date(Date.now() - created.length * 86400000) : null,
      isFeatured: Boolean(item.featured),
      inVirtualGallery: status === 'published',
      moderation:
        status === 'published'
          ? { reviewedAt: new Date(), reviewedBy: adminId, note: 'Approved during seeding.' }
          : {},
    });

    created.push(artwork);
  }

  // Keep the denormalised per-artist counter honest.
  for (const [, artist] of artistsByKey) {
    // eslint-disable-next-line no-await-in-loop
    const count = await Artwork.countDocuments({ artist: artist.profile._id, status: 'published' });
    // eslint-disable-next-line no-await-in-loop
    await ArtistProfile.updateOne(
      { _id: artist.profile._id },
      { $set: { 'stats.publishedArtworks': count } },
    );
  }

  log(`created ${created.length} artworks`);
  return created;
};

const seedCustomers = async () => {
  const customers = [];

  for (const customer of CUSTOMERS) {
    // eslint-disable-next-line no-await-in-loop
    const user = await createUser({ ...customer, role: 'customer' });

    // eslint-disable-next-line no-await-in-loop
    await Address.create({
      user: user._id,
      label: 'Home',
      fullName: customer.name,
      phone: '+91 98200 00000',
      line1: '14 Shanti Apartments',
      line2: 'Off Linking Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400050',
      country: 'India',
      isDefault: true,
    });

    customers.push(user);
  }

  log(`created ${customers.length} customers`);
  return customers;
};

/**
 * Seeds one enquiry so the artist dashboard has something to answer. No order
 * or payment is seeded: an order would imply a payment that never happened,
 * and simulated money has no place in a fresh database.
 */
const seedEnquiry = async (customers, artistsByKey, artworks) => {
  const customer = customers[0];
  const jay = artistsByKey.get('jay');
  const commissionPiece = artworks.find((artwork) => artwork.type === 'commission');

  await CommissionRequest.create({
    reference: 'CMS-SEED-01',
    kind: 'commission',
    customer: customer._id,
    contactName: customer.name,
    contactEmail: customer.email,
    contactPhone: '+91 98200 00000',
    artist: jay.profile._id,
    artistUser: jay.user._id,
    artwork: commissionPiece?._id ?? null,
    subject: 'Large colour field for a stairwell',
    message:
      'We have a double-height stairwell with north light and about 150 by 200cm of wall. Interested in something in the green range, close to Lime Interval but cooler. What is the timeline and what would it cost?',
    preferredSize: '150 x 200 cm',
    budgetMinor: toMinor(250000),
    status: 'new',
  });

  await Notification.create({
    user: jay.user._id,
    type: 'commission_received',
    title: 'New commission request (CMS-SEED-01)',
    body: 'Large colour field for a stairwell',
    link: '/artist/enquiries',
  });

  log('created 1 commission enquiry');
};

/* ──────────────────────────────── Run ──────────────────────────────── */

/**
 * Populates an already-connected database. Exported so the dev server can
 * seed an in-memory instance on boot, where a separate CLI process would be
 * writing to a database nothing else can see.
 */
export const seedAll = async () => {
  await clearDatabase();

  const categories = await seedCategories();
  const admin = await seedAdmin();
  const artists = await seedArtists(admin._id);
  const artworks = await seedArtworks(artists, categories, admin._id);
  const customers = await seedCustomers();
  await seedEnquiry(customers, artists, artworks);

  return { admin, artists, artworks, customers, categories };
};

export const printCredentials = () => {
  console.log('\n[seed] Sign-in details (development data only):');
  console.log(`  admin     ${env.auth.adminBootstrapEmail || 'admin@artsbyjay.test'}   ${SEED_PASSWORD}`);
  ARTISTS.forEach((artist) => console.log(`  artist    ${artist.email}   ${SEED_PASSWORD}`));
  CUSTOMERS.forEach((customer) => console.log(`  customer  ${customer.email}   ${SEED_PASSWORD}`));
  console.log('');
};

const runCli = async () => {
  if (env.db.useMemory) {
    console.error(
      '[seed] USE_MEMORY_DB=true discards the database when the process stops, so seeding from a separate process has no effect.',
    );
    console.error('[seed] Either point MONGODB_URI at a real MongoDB, or just run `npm run dev` —');
    console.error('[seed] the dev server seeds its in-memory database automatically on boot.');
    process.exit(1);
  }

  await connectDatabase();
  await seedAll();
  printCredentials();

  await disconnectDatabase();
  process.exit(0);
};

// Only run as a CLI when invoked directly, not when imported by the server.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (invokedDirectly) {
  runCli().catch(async (err) => {
    console.error('[seed] failed:', err);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
}

export {
  clearDatabase,
  seedCategories,
  seedAdmin,
  seedArtists,
  seedArtworks,
  seedCustomers,
  seedEnquiry,
  SEED_PASSWORD,
};
