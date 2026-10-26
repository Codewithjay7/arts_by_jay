/**
 * Answers one question: is checkout actually working right now?
 *
 *   node supabase/check-payments.mjs
 *
 * It signs in as a seeded customer, puts a real artwork in the cart, and
 * calls create-order for real. That is the only way to know: the function can
 * be deployed, the secrets can be set, and the thing can still refuse. It
 * reads the live answer rather than inferring one from configuration.
 *
 * It does NOT complete a payment — that needs a human in Razorpay's window —
 * and it cancels anything it creates so your order list stays clean.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({ path: path.join(root, 'server', '.env') });

const URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = process.env.SEED_PASSWORD ?? 'ArtsByJay2025';
const EMAIL = 'priya@collector.test';

if (!URL || !PUBLISHABLE) {
  console.error('\n[check] SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are needed in server/.env.\n');
  process.exit(1);
}

const db = createClient(URL, PUBLISHABLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

/**
 * Takes the probe's artwork back out of the cart.
 *
 * `db.rpc(...)` returns a PostgrestBuilder: it is thenable, so `await` works,
 * but it has no `.catch` method - calling one throws "catch is not a
 * function" and that failure surfaced AFTER the real result, making a working
 * check look broken.
 */
const emptyCart = async (artworkId) => {
  try {
    await db.rpc('set_cart_quantity', { p_artwork_id: artworkId, p_quantity: 0 });
  } catch {
    // Leaving one row in a test cart is not worth failing over.
  }
};

const run = async () => {
  console.log('\n── Is checkout live? ──\n');

  /* ── 1. Can a customer sign in at all? ── */
  const { data: session, error: signInError } = await db.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) {
    line('sign in', `FAILED — ${signInError.message}`);
    console.log('\n  Stopping: without a session nothing else can be tested.\n');
    process.exit(1);
  }
  line('sign in', 'ok');

  /* ── 2. Put something real in the cart, priced by the database. ── */
  const { data: artworks } = await db
    .from('artworks')
    .select('id, title, price_minor')
    .eq('status', 'published')
    .gt('stock', 0)
    .limit(1);

  if (!artworks?.length) {
    line('a sellable artwork', 'NONE FOUND — run the seed first');
    process.exit(1);
  }

  const artwork = artworks[0];
  const { data: cart, error: cartError } = await db.rpc('add_to_cart', {
    p_artwork_id: artwork.id,
    p_quantity: 1,
  });

  if (cartError) {
    line('add to cart', `FAILED — ${cartError.message}`);
    process.exit(1);
  }

  line('add to cart', `ok — ${artwork.title}`);
  line('priced by the server', `${(cart.subtotal_minor / 100).toLocaleString('en-IN')} INR subtotal`);
  line('platform commission', `${(cart.commission_minor / 100).toLocaleString('en-IN')} INR`);
  line('artist earns', `${(cart.artist_earnings_minor / 100).toLocaleString('en-IN')} INR`);
  line('can proceed', String(cart.can_proceed));

  /* ── 3. The real question. ── */
  const { data: created, error: orderError } = await db.functions.invoke('create-order', {
    body: {
      shipping_address: {
        full_name: 'Payment Check',
        phone: '9000000000',
        line1: '1 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400001',
        country: 'India',
      },
      shipping_method: 'standard',
      idempotency_key: `check-${Date.now()}`,
    },
  });

  console.log('');

  if (orderError) {
    // The real reason is on the error's context Response, not its message.
    let code = '';
    let message = orderError.message;
    try {
      const body = await orderError.context?.json();
      code = body?.error?.code ?? '';
      message = body?.error?.message ?? message;
    } catch {
      /* not JSON */
    }

    line('create-order', `REFUSED — ${code || 'error'}`);
    console.log(`\n  "${message}"\n`);

    if (code === 'PAYMENTS_DISABLED') {
      console.log('  Checkout is NOT live. The function is deployed but has no Razorpay');
      console.log('  secrets, so it refuses rather than pretending to take a payment.');
      console.log('');
      console.log('  Fix: put RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env, then');
      console.log('       node supabase/set-function-secrets.mjs');
      console.log('');
    }

    await emptyCart(artwork.id);
    process.exit(1);
  }

  line('create-order', 'ok');
  line('order number', created.order.order_number);
  line('gateway order', created.payment.order_id);
  line('amount to pay', `${(created.payment.amount / 100).toLocaleString('en-IN')} INR`);

  console.log('\n  Checkout IS live. A real card payment still needs a person in');
  console.log('  Razorpay\'s window — that part cannot be tested from a script.');

  /* ── 4. Leave nothing behind. ── */
  const { error: cancelError } = await db.rpc('cancel_my_order', {
    p_order_number: created.order.order_number,
    p_reason: 'Automated payment check',
  });
  console.log('');
  line('test order cancelled', cancelError ? `could not: ${cancelError.message}` : 'ok');

  await emptyCart(artwork.id);
  console.log('');
};

run().catch((err) => {
  console.error('\n[check] the run itself threw:', err.message, '\n');
  process.exit(1);
});
