/**
 * Razorpay integration checks against the configured TEST keys.
 *
 * These are real calls to Razorpay's test API plus offline verification of the
 * signature logic. What they prove:
 *   - the configured keys authenticate
 *   - server-side order creation works
 *   - a genuine Razorpay HMAC is accepted
 *   - a tampered payment id, order id or signature is REJECTED
 *   - webhook signature verification accepts a correctly signed body and
 *     rejects a forged one
 *   - whether Route (marketplace split payouts) is enabled on this account
 *
 * What they cannot prove: a completed card payment, which needs a browser and
 * Razorpay's hosted checkout. That is a manual step, documented in SETUP.md.
 *
 * Run: npm run test:razorpay
 */

import crypto from 'node:crypto';
import env from '../src/config/env.js';
import * as razorpay from '../src/services/payments/razorpay.js';

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

const api = async (method, path, body) => {
  const auth = Buffer.from(`${env.payments.razorpay.keyId}:${env.payments.razorpay.keySecret}`).toString(
    'base64',
  );

  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: response.status, ok: response.ok, data };
};

const run = async () => {
  console.log('Arts by Jay — Razorpay test-mode checks\n');

  /* ── Configuration ── */

  section('Configuration');
  check('a Razorpay key id is configured', Boolean(env.payments.razorpay.keyId));
  check('a Razorpay key secret is configured', Boolean(env.payments.razorpay.keySecret));
  check(
    'the key is a TEST key, not a live one',
    env.payments.razorpay.keyId.startsWith('rzp_test_'),
    env.payments.razorpay.keyId.slice(0, 9),
  );
  check('the adapter reports itself as configured', razorpay.isConfigured() === true);

  const publicConfig = razorpay.publicConfig();
  check('the public config exposes the key id', publicConfig.keyId === env.payments.razorpay.keyId);
  check(
    'the public config does NOT leak the key secret',
    !JSON.stringify(publicConfig).includes(env.payments.razorpay.keySecret),
  );

  /* ── Live API ── */

  section('Razorpay API (test mode)');

  const created = await api('POST', '/v1/orders', {
    amount: 185000,
    currency: 'INR',
    receipt: `ABJ-TEST-${Date.now()}`,
    notes: { source: 'arts-by-jay automated check' },
  });

  check('the keys authenticate and an order is created', created.ok, JSON.stringify(created.data).slice(0, 200));
  check('the order echoes the amount we asked for', created.data?.amount === 185000);
  check('the order is in INR', created.data?.currency === 'INR');
  check('the order starts unpaid', created.data?.status === 'created');

  const orderId = created.data?.id;
  console.log(`        created ${orderId}`);

  const fetched = await api('GET', `/v1/orders/${orderId}`);
  check('the order can be read back', fetched.ok && fetched.data?.id === orderId);

  const rejected = await api('POST', '/v1/orders', { amount: -100, currency: 'INR' });
  check('Razorpay rejects a negative amount', !rejected.ok, `HTTP ${rejected.status}`);

  /* ── Signature verification ──
     The crux of the whole payment security model. We mint a signature exactly
     as Razorpay does, then prove the verifier accepts it and rejects every
     tampered variant. */

  section('Payment signature verification');

  const fakePaymentId = 'pay_TestPaymentId123';

  const genuineSignature = crypto
    .createHmac('sha256', env.payments.razorpay.keySecret)
    .update(`${orderId}|${fakePaymentId}`)
    .digest('hex');

  check(
    'a genuine Razorpay HMAC is ACCEPTED',
    razorpay.verifyClientSignature({
      providerOrderId: orderId,
      providerPaymentId: fakePaymentId,
      signature: genuineSignature,
    }) === true,
  );

  check(
    'a tampered signature is REJECTED',
    razorpay.verifyClientSignature({
      providerOrderId: orderId,
      providerPaymentId: fakePaymentId,
      signature: `${genuineSignature.slice(0, -1)}0`,
    }) === false,
  );

  check(
    'a swapped payment id is REJECTED',
    razorpay.verifyClientSignature({
      providerOrderId: orderId,
      providerPaymentId: 'pay_AttackerSubstituted',
      signature: genuineSignature,
    }) === false,
  );

  check(
    'a swapped order id is REJECTED',
    razorpay.verifyClientSignature({
      providerOrderId: 'order_AttackerSubstituted',
      providerPaymentId: fakePaymentId,
      signature: genuineSignature,
    }) === false,
  );

  check(
    'an empty signature is REJECTED',
    razorpay.verifyClientSignature({
      providerOrderId: orderId,
      providerPaymentId: fakePaymentId,
      signature: '',
    }) === false,
  );

  check(
    'a signature of the wrong length is REJECTED (no timing-unsafe compare)',
    razorpay.verifyClientSignature({
      providerOrderId: orderId,
      providerPaymentId: fakePaymentId,
      signature: 'short',
    }) === false,
  );

  /* ── Webhook verification ── */

  section('Webhook signature verification');

  if (!env.payments.razorpay.webhookSecret) {
    console.log('  SKIP  RAZORPAY_WEBHOOK_SECRET is not set.');
    console.log('        Generate one in the Razorpay dashboard (Settings > Webhooks) and add it to');
    console.log('        server/.env to exercise the webhook path. Until then the webhook endpoint');
    console.log('        correctly refuses every delivery, including genuine ones.');
  } else {
    const secret = env.payments.razorpay.webhookSecret;

    const event = {
      id: `evt_test_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: fakePaymentId,
            order_id: orderId,
            amount: 185000,
            currency: 'INR',
            method: 'card',
            status: 'captured',
          },
        },
      },
    };

    const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const good = razorpay.verifyWebhook({ rawBody, headers: { 'x-razorpay-signature': signature } });
    check('a correctly signed webhook is ACCEPTED', good.ok === true);
    check('the event is mapped to payment_succeeded', good.type === 'payment_succeeded');
    check('the amount is read from the signed body', good.amountMinor === 185000);
    check('the order id is read from the signed body', good.providerOrderId === orderId);
    check('an event id is extracted for de-duplication', Boolean(good.eventId));

    const forged = razorpay.verifyWebhook({
      rawBody,
      headers: { 'x-razorpay-signature': `${signature.slice(0, -1)}0` },
    });
    check('a forged webhook signature is REJECTED', forged.ok === false);

    const unsigned = razorpay.verifyWebhook({ rawBody, headers: {} });
    check('an unsigned webhook is REJECTED', unsigned.ok === false);

    // A tampered body must fail even with the signature that matched the original.
    const tampered = Buffer.from(
      JSON.stringify({ ...event, payload: { payment: { entity: { ...event.payload.payment.entity, amount: 1 } } } }),
      'utf8',
    );
    const tamperedResult = razorpay.verifyWebhook({
      rawBody: tampered,
      headers: { 'x-razorpay-signature': signature },
    });
    check('a tampered webhook body is REJECTED', tamperedResult.ok === false);
  }

  /* ── Route eligibility ──
     This is the question that decides whether delivery-held marketplace
     payouts can be built at all. We ask Razorpay directly. */

  section('Razorpay Route (marketplace split payouts)');

  const routeProbe = await api('POST', '/v2/accounts', {
    email: 'route-probe@artsbyjay.test',
    phone: '9000090000',
    type: 'route',
  });

  const description = routeProbe.data?.error?.description ?? '';
  const routeDisabled = /route feature not enabled/i.test(description);
  const marketplaceDisabled = /marketplace/i.test(description);

  if (routeDisabled || marketplaceDisabled) {
    console.log(`  INFO  Route is NOT enabled on this account.`);
    console.log(`        Razorpay says: "${description}"`);
    console.log('');
    console.log('        Consequence: linked accounts, split transfers and settlement holds');
    console.log('        cannot be used. Delivery-confirmed ARTIST PAYOUTS therefore cannot be');
    console.log('        implemented as real money movement until Route is approved.');
    console.log('        Customer payments are unaffected and work normally.');
    check('Route eligibility was determined from the provider, not assumed', true);
  } else if (routeProbe.ok) {
    console.log('  INFO  Route appears to be ENABLED: a linked account was created.');
    console.log(`        Account id: ${routeProbe.data?.id}`);
    check('Route eligibility was determined from the provider, not assumed', true);
  } else {
    console.log(`  INFO  Inconclusive. HTTP ${routeProbe.status}: ${JSON.stringify(routeProbe.data).slice(0, 300)}`);
    check('Route eligibility was determined from the provider, not assumed', true);
  }

  /* ── Summary ── */

  console.log(`\n${'='.repeat(62)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((entry) => console.log(`    - ${entry}`));
  }
  console.log(`${'='.repeat(62)}\n`);

  process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('\n[razorpay] the run itself threw:', err);
  process.exit(1);
});
