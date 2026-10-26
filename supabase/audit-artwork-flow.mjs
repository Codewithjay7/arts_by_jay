/**
 * Walks a piece of art from "an artist adds it" to "a visitor can see it".
 *
 *   node --import ./supabase/esm-resolve-hook.mjs supabase/audit-artwork-flow.mjs
 *
 * This exists because "I added a piece and it never appeared" is impossible to
 * answer from the outside. Nothing is broken when that happens — the piece is
 * sitting in draft, or waiting on a curator — but no page said so, and a
 * silent queue is indistinguishable from a lost upload.
 *
 * So the pipeline is asserted end to end, in order, with the refusals that
 * matter: an artist must not be able to publish their own work, and an
 * unsubmitted piece must not be visible to buyers.
 *
 * Uses the real data-layer functions, and deletes the piece it creates.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({ path: path.join(root, 'server', '.env') });

globalThis.window ??= { location: { origin: 'https://artsbyjay.netlify.app' } };

const load = (f) => import(`file:///${path.join(root, 'client', 'src', 'lib', 'data', f).replace(/\\/g, '/')}`);

const [artist, admin, artworks, sup] = await Promise.all([
  load('artist.js'),
  load('admin.js'),
  load('artworks.js'),
  import(`file:///${path.join(root, 'client', 'src', 'lib', 'supabase.js').replace(/\\/g, '/')}`),
]);

const supabase = sup.supabase;
const PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (t) => console.log(`\n── ${t} ──`);

const as = async (email) => {
  await supabase.auth.signOut();
  if (!email) return null;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return data.user.id;
};

const title = `Flow Audit ${Date.now()}`;
let created = null;
let uploadedPath = null;

const run = async () => {
  /* ─────────── The artist uploads a real image ─────────── */
  section('An artist can put a real picture on their own work');

  const artistId = await as('jay@artsbyjay.test');

  // A one-pixel PNG is enough to prove the storage path and its policies.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  uploadedPath = `${artistId}/flow-audit-${Date.now()}.png`;
  const upload = await supabase.storage
    .from('artworks')
    .upload(uploadedPath, new File([png], 'art.png', { type: 'image/png' }), { contentType: 'image/png' });

  check('upload into their own folder', !upload.error, upload.error?.message);

  const { data: pub } = supabase.storage.from('artworks').getPublicUrl(uploadedPath);
  const fetched = await fetch(pub.publicUrl);
  check('the uploaded image is publicly fetchable', fetched.ok, `HTTP ${fetched.status}`);

  /* ─────────── Draft ─────────── */
  section('A new piece starts as a draft, not on the marketplace');

  const cats = await artworks.listCategories();
  const categoryId = (cats.items[0].children?.[0] ?? cats.items[0]).id;

  const result = await artist.createMyArtwork({
    category: categoryId,
    title,
    description: 'Created by the artwork flow audit.',
    price: 2500,
    type: 'original',
    medium: 'Oil on panel',
    year: 2025,
    dimensions: { width: 40, height: 50, depth: 3 },
    stock: 1,
    images: [{ url: pub.publicUrl, thumbUrl: pub.publicUrl, alt: title }],
  });

  created = result.artwork;
  check('a new piece is created as a draft', created.status === 'draft', `got "${created.status}"`);

  const mine = await artist.listMyArtworks({ limit: 100 });
  check('the artist sees it in their own list', mine.items.some((a) => a.id === created.id));

  await as(null);
  const beforeReview = await artworks.browseArtworks({ q: 'Flow Audit', limit: 20 });
  check(
    'a visitor canNOT see an unsubmitted draft',
    !beforeReview.items.some((a) => a.id === created.id),
  );

  /* ─────────── Review ─────────── */
  section('The artist submits it, and cannot publish it themselves');

  await as('jay@artsbyjay.test');
  const submitted = await artist.setMyArtworkStatus(created.id, 'publish');
  check(
    'submitting puts it in review, not live',
    submitted.artwork.status === 'pending',
    `got "${submitted.artwork.status}"`,
  );

  // The single most important refusal here: a seller must not be able to put
  // their own work on the marketplace without a curator.
  const selfPublish = await artist.setMyArtworkStatus(created.id, 'published').catch(() => null);
  const afterSelfPublish = (await artist.getMyArtwork(created.id)).artwork;
  check(
    'an artist cannot publish their own work',
    afterSelfPublish.status !== 'published',
    `status is "${afterSelfPublish.status}"`,
  );
  void selfPublish;

  await as(null);
  const inReview = await artworks.browseArtworks({ q: 'Flow Audit', limit: 20 });
  check('a visitor canNOT see a piece that is in review', !inReview.items.some((a) => a.id === created.id));

  /* ─────────── Approval ─────────── */
  section('A curator approves it, and only then is it public');

  await as('admin@artsbyjay.test');
  const queue = await admin.listArtworksForModeration({ limit: 200 });
  check(
    'it reaches the curator queue',
    queue.items.some((a) => a.id === created.id),
    'a curator would never find it',
  );

  const approved = await admin.moderateArtwork(created.id, { decision: 'approve', note: 'flow audit' });
  check('approving publishes it', approved.artwork.status === 'published', `got "${approved.artwork.status}"`);

  await as(null);
  const afterApproval = await artworks.browseArtworks({ q: 'Flow Audit', limit: 20 });
  check(
    'a visitor can now see it',
    afterApproval.items.some((a) => a.id === created.id),
    'it is published but still not on the marketplace',
  );

  const detail = await artworks.getArtworkDetail(created.slug ?? afterApproval.items[0]?.slug);
  check('and can open its detail page', Boolean(detail?.artwork?.id), 'detail page did not load');
};

const cleanUp = async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  if (created) await service.from('artworks').delete().eq('id', created.id);
  if (uploadedPath) await service.storage.from('artworks').remove([uploadedPath]);

  // Prove it, rather than assume it: a probe that leaves listings behind
  // quietly fills the marketplace with its own rubbish.
  const left = await service.from('artworks').select('id').like('title', 'Flow Audit %');
  check('the audit removed everything it created', (left.data ?? []).length === 0, `${left.data?.length} left`);

  await supabase.auth.signOut();
};

try {
  await run();
} catch (error) {
  failed += 1;
  failures.push(`the run threw: ${error.message}`);
  console.log(`\n  FAIL  the run threw: ${error.message}`);
} finally {
  await cleanUp();
}

console.log(`\n${'='.repeat(64)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach((f) => console.log(`    - ${f}`));
}
console.log(`${'='.repeat(64)}\n`);

process.exit(failed > 0 ? 1 : 0);
