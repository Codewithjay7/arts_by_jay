/**
 * Cross-tenant probe: can one signed-in user reach another's data?
 *
 *   node supabase/audit-tenancy.mjs
 *
 * verify.mjs checks that the policies express the right intent. This asks a
 * blunter question, as a real user with a real token: for every table that
 * holds per-user data, try to READ someone else's rows, try to WRITE to them,
 * and try to grant yourself a role you do not have.
 *
 * It is deliberately adversarial and deliberately dumb — it does not consult
 * the policies, it just tries things. A policy can be correct and still be
 * attached to the wrong command, or be bypassed by an RPC that forgot its
 * privilege check, and only an attempt finds that.
 *
 * Nothing here is destructive: every write it attempts is expected to be
 * refused, and the one it performs on its own row is reverted.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', 'server', '.env') });

const URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';

if (!URL || !PUBLISHABLE || !SECRET) {
  console.error('\n[tenancy] need SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(URL, PUBLISHABLE, opts);
const service = createClient(URL, SECRET, opts);

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

const signIn = async (email) => {
  const c = createClient(URL, PUBLISHABLE, opts);
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`cannot sign in as ${email}: ${error.message}`);
  return { client: c, userId: data.user.id, email };
};

const run = async () => {
  const priya = await signIn('priya@collector.test');
  const arjun = await signIn('arjun@collector.test');
  const jay = await signIn('jay@artsbyjay.test');
  const anaya = await signIn('anaya@artsbyjay.test');

  /* ───────────── Reading another user's rows ───────────── */
  section('A customer cannot READ another customer');

  // Every table keyed to a user, with the column that owns the row. The probe
  // asks for the OTHER user's rows explicitly: RLS should return nothing
  // rather than refusing, because a filter on an invisible row simply matches
  // no rows.
  const owned = [
    ['profiles', 'id'],
    ['addresses', 'user_id'],
    ['carts', 'user_id'],
    ['wishlist_items', 'user_id'],
    ['notifications', 'user_id'],
    ['orders', 'customer_id'],
  ];

  for (const [table, column] of owned) {
    const { data, error } = await priya.client.from(table).select('*').eq(column, arjun.userId);
    check(
      `${table}: no rows of another user's returned`,
      !error && (data ?? []).length === 0,
      error ? `${error.code}: ${error.message}` : `${data?.length} row(s) leaked`,
    );
  }

  /* ───────────── Writing to another user's rows ───────────── */
  section('A customer cannot WRITE to another customer');

  const otherProfile = await priya.client
    .from('profiles')
    .update({ full_name: 'Tampered By Probe' })
    .eq('id', arjun.userId)
    .select('id');
  check(
    'profiles: cannot rename another user',
    (otherProfile.data ?? []).length === 0,
    `${(otherProfile.data ?? []).length} row(s) changed`,
  );

  const otherAddress = await service.from('addresses').select('id').eq('user_id', arjun.userId).limit(1);
  const arjunAddressId = otherAddress.data?.[0]?.id;
  if (arjunAddressId) {
    const hijack = await priya.client
      .from('addresses')
      .update({ city: 'Tampered' })
      .eq('id', arjunAddressId)
      .select('id');
    check(
      'addresses: cannot edit another user\'s address',
      (hijack.data ?? []).length === 0,
      `${(hijack.data ?? []).length} row(s) changed`,
    );

    const steal = await priya.client.from('addresses').delete().eq('id', arjunAddressId).select('id');
    check(
      'addresses: cannot delete another user\'s address',
      (steal.data ?? []).length === 0,
      `${(steal.data ?? []).length} row(s) deleted`,
    );
  }

  // Inserting a row that CLAIMS to belong to someone else.
  const forged = await priya.client
    .from('addresses')
    .insert({
      user_id: arjun.userId,
      label: 'Forged',
      full_name: 'Probe',
      phone: '9000000000',
      line1: '1 Probe Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      postal_code: '400001',
      country: 'India',
    })
    .select('id');
  check(
    'addresses: cannot insert a row owned by another user',
    Boolean(forged.error) || (forged.data ?? []).length === 0,
    'the insert was accepted',
  );
  // If it somehow succeeded, do not leave it behind.
  if (forged.data?.[0]?.id) await service.from('addresses').delete().eq('id', forged.data[0].id);

  /* ───────────── Privilege escalation ───────────── */
  section('Nobody can grant themselves a role');

  // Only roles the actor does NOT already hold.
  //
  // The guard compares with `is distinct from`, so writing the role you
  // already have is a no-op and is correctly allowed. An earlier version of
  // this probe asked an artist to "escalate" to artist and reported the
  // resulting no-op as a privilege escalation — a false alarm that would have
  // sent someone hunting a vulnerability that does not exist.
  for (const actor of [priya, jay]) {
    const current = (await actor.client.from('profiles').select('role').eq('id', actor.userId).single()).data?.role;

    for (const role of ['admin', 'artist', 'customer'].filter((r) => r !== current)) {
      const attempt = await actor.client
        .from('profiles')
        .update({ role })
        .eq('id', actor.userId)
        .select('id, role');

      // Re-read rather than trusting the response: a policy that hides the
      // row would return nothing even if the write landed.
      const after = (await service.from('profiles').select('role').eq('id', actor.userId).single()).data?.role;

      check(
        `${actor.email} (${current}) cannot change their own role to ${role}`,
        after === current,
        `role is now ${after}`,
      );
    }
  }

  // The real attack on is_active: a user who is signed in, is then suspended,
  // and tries to switch themselves back on with the token they already hold.
  // Writing `is_active: true` while already active proves nothing, because the
  // guard only fires on an actual change.
  const selfDeactivate = await priya.client
    .from('profiles')
    .update({ is_active: false })
    .eq('id', priya.userId)
    .select('id');
  const stillActive = (await service.from('profiles').select('is_active').eq('id', priya.userId).single()).data;
  check(
    'a customer cannot change their own is_active',
    Boolean(selfDeactivate.error) && stillActive?.is_active === true,
    `is_active is now ${stillActive?.is_active}`,
  );

  try {
    // Suspend out-of-band, exactly as an admin would.
    await service.from('profiles').update({ is_active: false, suspended_reason: 'tenancy probe' }).eq('id', priya.userId);

    const reactivate = await priya.client
      .from('profiles')
      .update({ is_active: true, suspended_reason: '' })
      .eq('id', priya.userId)
      .select('id');

    const after = (await service.from('profiles').select('is_active').eq('id', priya.userId).single()).data;

    check(
      'a SUSPENDED user cannot reactivate themselves',
      Boolean(reactivate.error) && after?.is_active === false,
      `is_active is now ${after?.is_active}`,
    );
  } finally {
    // Always restore, even if a check above threw: leaving a seeded account
    // suspended would break every later run and the live site's demo login.
    await service
      .from('profiles')
      .update({ is_active: true, suspended_reason: '' })
      .eq('id', priya.userId);
    const restored = (await service.from('profiles').select('is_active, suspended_reason').eq('id', priya.userId).single()).data;
    check(
      'the probe restored the account it suspended',
      restored?.is_active === true && !restored?.suspended_reason,
      `is_active=${restored?.is_active} reason="${restored?.suspended_reason}"`,
    );
  }

  /* ───────────── Artist boundaries ───────────── */
  section('An artist is confined to their own work');

  const anayaArtwork = await service
    .from('artworks')
    .select('id, title, artist_id, owner_id')
    .eq('owner_id', anaya.userId)
    .limit(1);
  const target = anayaArtwork.data?.[0];

  if (target) {
    const edit = await jay.client
      .from('artworks')
      .update({ title: 'Tampered By Probe' })
      .eq('id', target.id)
      .select('id');
    check(
      'an artist cannot edit another artist\'s artwork',
      (edit.data ?? []).length === 0,
      `${(edit.data ?? []).length} row(s) changed`,
    );

    const destroy = await jay.client.from('artworks').delete().eq('id', target.id).select('id');
    check(
      'an artist cannot delete another artist\'s artwork',
      (destroy.data ?? []).length === 0,
      `${(destroy.data ?? []).length} row(s) deleted`,
    );
  }

  // Publishing one's own work without a curator, and self-featuring.
  const draft = await service
    .from('artworks')
    .insert({
      title: 'Tenancy Probe Draft',
      slug: `tenancy-probe-${Date.now()}`,
      artist_id: (await service.from('artist_profiles').select('id').eq('user_id', jay.userId).single()).data.id,
      owner_id: jay.userId,
      price_minor: 100000,
      status: 'draft',
      stock: 1,
      type: 'original',
    })
    .select('id')
    .single();

  if (draft.data) {
    const publish = await jay.client
      .from('artworks')
      .update({ status: 'published' })
      .eq('id', draft.data.id)
      .select('id, status');
    check(
      'an artist cannot publish their own work without review',
      Boolean(publish.error) || publish.data?.[0]?.status !== 'published',
      'it was published',
    );

    const feature = await jay.client
      .from('artworks')
      .update({ is_featured: true })
      .eq('id', draft.data.id)
      .select('id, is_featured');
    check(
      'an artist cannot feature their own work',
      Boolean(feature.error) || feature.data?.[0]?.is_featured !== true,
      'it was featured',
    );

    await service.from('artworks').delete().eq('id', draft.data.id);
  }

  /* ───────────── Admin-only RPCs ───────────── */
  section('Admin-only functions refuse everyone else');

  const adminRpcs = [
    ['admin_payout_queue', {}],
    ['admin_audit_log', {}],
    ['admin_artist_stats', {}],
    ['admin_refresh_eligibility', {}],
  ];

  for (const [fn, args] of adminRpcs) {
    for (const actor of [priya, jay]) {
      const { error } = await actor.client.rpc(fn, args);
      check(`${fn} refuses ${actor.email}`, Boolean(error), 'it was allowed');
    }
    const { error: anonError } = await anon.rpc(fn, args);
    check(`${fn} refuses an anonymous caller`, Boolean(anonError), 'it was allowed');
  }

  /* ───────────── Anonymous reach ───────────── */
  section('An anonymous visitor sees only public data');

  for (const table of ['profiles', 'addresses', 'orders', 'order_items', 'carts', 'notifications', 'audit_logs']) {
    const { data } = await anon.from(table).select('*').limit(1);
    check(`${table}: nothing visible anonymously`, (data ?? []).length === 0, `${data?.length} row(s) leaked`);
  }

  // Unpublished work must not be readable by the public.
  const drafts = await anon.from('artworks').select('id, status').neq('status', 'published').limit(1);
  check('artworks: no unpublished work visible anonymously', (drafts.data ?? []).length === 0);

  /* ───────────── Summary ───────────── */
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
  console.error('\n[tenancy] the run itself threw:', err.message, '\n');
  process.exit(1);
});
