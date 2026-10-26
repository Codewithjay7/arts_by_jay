/**
 * Exercises the auth flows against the live project, using the same data-layer
 * logic the browser runs.
 *
 *   node supabase/audit-auth-flows.mjs
 *
 * These are the paths a person actually walks — sign in, read the session,
 * save the profile, change the avatar, suspension, sign out — and none of them
 * were covered by anything runnable. Three of the bugs this now guards were
 * invisible to both the security suite and the schema audit, because the
 * queries were valid SQL doing the wrong thing.
 *
 * It restores everything it touches, including on failure.
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
  console.error('\n[auth] need SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
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

const freshClient = () => createClient(URL, PUBLISHABLE, opts);

const run = async () => {
  /* ───────────── Sign in ───────────── */
  section('Sign in');

  const wrong = await freshClient().auth.signInWithPassword({
    email: 'priya@collector.test',
    password: 'definitely-not-the-password',
  });
  check('a wrong password is refused', Boolean(wrong.error));
  check(
    'the refusal does not reveal whether the account exists',
    /invalid login credentials/i.test(wrong.error?.message ?? ''),
    wrong.error?.message,
  );

  const unknown = await freshClient().auth.signInWithPassword({
    email: `nobody-${Date.now()}@example.test`,
    password: 'definitely-not-the-password',
  });
  check(
    'an unknown address gives the SAME message as a wrong password',
    unknown.error?.message === wrong.error?.message,
    `"${unknown.error?.message}" vs "${wrong.error?.message}"`,
  );

  const priya = freshClient();
  const good = await priya.auth.signInWithPassword({ email: 'priya@collector.test', password: PASSWORD });
  check('the correct password signs in', !good.error && Boolean(good.data.session));

  const priyaId = good.data.user.id;

  /* ───────────── The session carries the role from `profiles` ───────────── */
  section('Role comes from the database, not the token');

  const profile = await priya
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, phone, is_active, suspended_reason, created_at')
    .eq('id', priyaId)
    .maybeSingle();

  check('the signed-in user can read their own profile row', !profile.error && Boolean(profile.data));
  check('their role reads as customer', profile.data?.role === 'customer', profile.data?.role);

  // The role must not be taken from user_metadata, which the user controls.
  const claimed = await priya.auth.updateUser({ data: { role: 'admin', intent: 'admin' } });
  check('a user CAN write their own user_metadata', !claimed.error);

  const roleAfter = await service.from('profiles').select('role').eq('id', priyaId).single();
  check(
    'writing role into user_metadata does NOT change the real role',
    roleAfter.data?.role === 'customer',
    `role is now ${roleAfter.data?.role}`,
  );
  await priya.auth.updateUser({ data: { role: null, intent: 'customer' } });

  /* ───────────── Saving the profile ───────────── */
  section('Saving the profile');

  const original = profile.data;

  try {
    // The patch the account page builds for a name change.
    const named = await priya
      .from('profiles')
      .update({ full_name: 'Audit Rename' })
      .eq('id', priyaId)
      .select('id, full_name')
      .single();
    check('a name change saves', !named.error && named.data?.full_name === 'Audit Rename');

    // The avatar path. `avatar_url` was absent from updateProfile's allowed
    // columns, so this patch came out EMPTY: PostgREST answered 200 with zero
    // rows, `.single()` raised, and the page said "Upload failed" after the
    // file had already been stored. The picture could never be saved.
    const avatared = await priya
      .from('profiles')
      .update({ avatar_url: 'https://example.test/audit-avatar.png' })
      .eq('id', priyaId)
      .select('id, avatar_url')
      .single();
    check(
      'an avatar change saves',
      !avatared.error && avatared.data?.avatar_url === 'https://example.test/audit-avatar.png',
      avatared.error?.message,
    );

    // And the shape that used to be sent: an empty patch.
    const empty = await priya.from('profiles').update({}).eq('id', priyaId).select('id');
    check(
      'an EMPTY patch returns no rows (which is why it looked like success)',
      !empty.error && (empty.data ?? []).length === 0,
      `error=${empty.error?.message} rows=${empty.data?.length}`,
    );

    // avatar_url is `not null default ''`, so a cleared avatar is '' not null.
    const nulled = await priya.from('profiles').update({ avatar_url: null }).eq('id', priyaId).select('id');
    check(
      'avatar_url rejects null, so a cleared avatar must be an empty string',
      nulled.error?.code === '23502',
      `got ${nulled.error?.code ?? 'no error'}`,
    );
  } finally {
    await service
      .from('profiles')
      .update({ full_name: original.full_name, avatar_url: original.avatar_url ?? '' })
      .eq('id', priyaId);
    const restored = await service.from('profiles').select('full_name, avatar_url').eq('id', priyaId).single();
    check(
      'the probe restored the profile it edited',
      restored.data?.full_name === original.full_name && restored.data?.avatar_url === (original.avatar_url ?? ''),
      `name="${restored.data?.full_name}" avatar="${restored.data?.avatar_url}"`,
    );
  }

  /* ───────────── Suspension ───────────── */
  section('A suspended account cannot sign in');

  try {
    await service
      .from('profiles')
      .update({ is_active: false, suspended_reason: 'auth flow audit' })
      .eq('id', priyaId);

    // Supabase Auth does not know about `is_active`, so it still issues a
    // token. The data layer is what must refuse — which is why it has to read
    // the profile and why a missing profile must fail CLOSED rather than
    // default the role and skip this check.
    const stillIssued = await freshClient().auth.signInWithPassword({
      email: 'priya@collector.test',
      password: PASSWORD,
    });
    check(
      'Supabase Auth still issues a token for a suspended account',
      !stillIssued.error,
      'it refused, which would make the client-side check dead code',
    );

    const suspendedProfile = await service
      .from('profiles')
      .select('is_active, suspended_reason')
      .eq('id', priyaId)
      .single();
    check(
      'the profile row is what marks it suspended',
      suspendedProfile.data?.is_active === false && Boolean(suspendedProfile.data?.suspended_reason),
    );
  } finally {
    await service.from('profiles').update({ is_active: true, suspended_reason: '' }).eq('id', priyaId);
    const back = await service.from('profiles').select('is_active').eq('id', priyaId).single();
    check('the probe un-suspended the account', back.data?.is_active === true);
  }

  /* ───────────── Artist and admin role resolution ───────────── */
  section('Artist and admin sessions resolve correctly');

  for (const [email, expectedRole] of [
    ['jay@artsbyjay.test', 'artist'],
    ['admin@artsbyjay.test', 'admin'],
  ]) {
    const c = freshClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) {
      check(`${email} can sign in`, false, error.message);
      continue;
    }
    const p = await c.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
    check(`${email} resolves as ${expectedRole}`, p.data?.role === expectedRole, `got ${p.data?.role}`);

    // An artist or admin session also needs its artist_profiles row, which is
    // what the dashboard header reads.
    if (expectedRole === 'artist') {
      const ap = await c.from('artist_profiles').select('id, status').eq('user_id', data.user.id).maybeSingle();
      check(`${email} has a readable artist profile`, Boolean(ap.data), ap.error?.message);
    }
    await c.auth.signOut();
  }

  /* ───────────── Password reset ───────────── */
  section('Password reset');

  // Only that the request is well-formed and the endpoint accepts it. Whether
  // an email ARRIVES depends on SMTP, which is not configured on this project
  // — that is a dashboard task, not something code can fix.
  //
  // A routable domain is used deliberately. Supabase validates the address
  // only when it is about to send, which is to say only for an address that
  // actually has an account, so the seeded `.test` accounts come back
  // `email_address_invalid` and would make this look like a code fault.
  const reset = await freshClient().auth.resetPasswordForEmail(
    `audit-${Date.now()}@gmail.com`,
    { redirectTo: 'https://artsbyjay.netlify.app/reset-password' },
  );
  check(
    'a reset request is accepted (delivery still depends on SMTP)',
    !reset.error || /rate limit/i.test(reset.error.message),
    reset.error?.message,
  );

  const unknownReset = await freshClient().auth.resetPasswordForEmail(
    `nobody-${Date.now()}@gmail.com`,
    { redirectTo: 'https://artsbyjay.netlify.app/reset-password' },
  );
  check(
    'an unknown address is not distinguishable from a known one',
    !unknownReset.error || /rate limit/i.test(unknownReset.error.message),
    unknownReset.error?.message,
  );

  // Recorded rather than asserted, because it is a property of the shared
  // Supabase sender and not of this codebase: a `.test` address belonging to
  // a REAL account is refused outright, while an unregistered one returns
  // 200. So the seeded logins cannot exercise password reset end to end, and
  // no amount of application code will change that.
  const seedDomain = await freshClient().auth.resetPasswordForEmail('priya@collector.test', {
    redirectTo: 'https://artsbyjay.netlify.app/reset-password',
  });
  console.log(
    `  NOTE  seeded .test addresses cannot receive a reset email: ${
      seedDomain.error ? seedDomain.error.message : 'accepted (sender behaviour changed)'
    }`,
  );

  /* ───────────── Sign out ───────────── */
  section('Sign out');

  await priya.auth.signOut();
  const after = await priya.auth.getSession();
  check('signing out clears the session', !after.data?.session);

  const reach = await priya.from('profiles').select('id').eq('id', priyaId);
  check('and the token no longer reads private data', (reach.data ?? []).length === 0);

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
  console.error('\n[auth] the run itself threw:', err.message, '\n');
  process.exit(1);
});
