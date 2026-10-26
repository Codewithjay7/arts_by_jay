/**
 * POST /functions/v1/create-order
 *
 * Creates a `pending_payment` order and a matching Razorpay order.
 *
 * Every amount is computed by `public.price_cart()` in the database from the
 * current listings. The request body carries an address and a shipping choice
 * and nothing else — no prices, no totals, no commission. A client cannot
 * influence what it is charged.
 *
 * No stock is deducted and no sale is recorded here. That happens only after
 * the payment has been verified (see verify-payment and razorpay-webhook).
 */

import { fail, json, preflight } from '../_shared/cors.ts';
import { auditLog, razorpay, razorpayConfigured, razorpayKeyId, requireUser, serviceClient } from '../_shared/clients.ts';

interface Address {
  full_name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const SHIPPING_UPLIFT_MINOR: Record<string, number> = {
  standard: 0,
  express: 49900,
};

const BLOCKING_ISSUES = ['unavailable', 'sold_out', 'commission_only'];

const validateAddress = (address: unknown): string | null => {
  if (!address || typeof address !== 'object') return 'A delivery address is required.';
  const a = address as Record<string, unknown>;

  const required: Array<[keyof Address, number]> = [
    ['full_name', 2],
    ['phone', 6],
    ['line1', 4],
    ['city', 2],
    ['state', 2],
    ['postal_code', 3],
    ['country', 2],
  ];

  for (const [field, min] of required) {
    const value = a[field];
    if (typeof value !== 'string' || value.trim().length < min) {
      return `The delivery address is missing or incomplete: ${String(field).replace('_', ' ')}.`;
    }
  }
  return null;
};

Deno.serve(async (req) => {
  const flight = preflight(req);
  if (flight) return flight;

  if (req.method !== 'POST') return fail(req, 405, 'Use POST.');

  if (!razorpayConfigured()) {
    return fail(
      req,
      503,
      'Online payment is not configured on this server yet.',
      'PAYMENTS_DISABLED',
    );
  }

  const profile = await requireUser(req);
  if (!profile) return fail(req, 401, 'Please sign in to continue.');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, 'That request body is not valid JSON.', 'MALFORMED_JSON');
  }

  const shippingAddress = body.shipping_address;
  const addressError = validateAddress(shippingAddress);
  if (addressError) return fail(req, 422, addressError);

  const shippingMethod = typeof body.shipping_method === 'string' ? body.shipping_method : 'standard';
  if (!(shippingMethod in SHIPPING_UPLIFT_MINOR)) {
    return fail(req, 422, 'That shipping method is not available.');
  }

  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 100)) {
    return fail(req, 422, 'That idempotency key is not valid.');
  }

  const db = serviceClient();

  /* ── Idempotency ──
     A double-submitted checkout returns the ORIGINAL order, never a second
     one. The unique index on (customer_id, idempotency_key) backs this up if
     two requests race. */
  if (idempotencyKey) {
    const { data: existing } = await db
      .from('orders')
      .select('id, order_number, status, total_minor, currency')
      .eq('customer_id', profile.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing) {
      const { data: payment } = await db
        .from('payments')
        .select('provider, provider_order_id, amount_minor, currency')
        .eq('order_id', existing.id)
        .maybeSingle();

      return json(req, {
        order: existing,
        payment: payment
          ? {
              provider: payment.provider,
              key_id: razorpayKeyId(),
              order_id: payment.provider_order_id,
              amount: payment.amount_minor,
              currency: payment.currency,
            }
          : null,
        reused: true,
      });
    }
  }

  /* ── Price the cart in the database ── */

  const { data: lines, error: priceError } = await db.rpc('price_cart', { p_user_id: profile.id });

  if (priceError) {
    console.error('[create-order] pricing failed:', priceError.message);
    return fail(req, 500, 'We could not price your cart.');
  }
  if (!lines || lines.length === 0) {
    return fail(req, 400, 'Your cart is empty.');
  }

  type Line = {
    artwork_id: string;
    artist_id: string;
    artist_user_id: string;
    title: string;
    quantity: number | null;
    unit_price_minor: number | null;
    line_total_minor: number | null;
    shipping_minor: number | null;
    commission_rate_percent: number | null;
    commission_basis_minor: number | null;
    commission_minor: number | null;
    artist_earnings_minor: number | null;
    is_digital: boolean;
    issue_kind: string | null;
    issue_message: string | null;
  };

  const priced = lines as Line[];
  const issues = priced
    .filter((line) => line.issue_kind)
    .map((line) => ({ artwork_id: line.artwork_id, kind: line.issue_kind, message: line.issue_message }));

  const blocking = issues.filter((issue) => BLOCKING_ISSUES.includes(issue.kind ?? ''));
  if (blocking.length > 0) {
    return json(
      req,
      {
        error: {
          message: 'Your cart changed since you last reviewed it. Please check the highlighted items.',
          code: 'CART_CHANGED',
          details: { issues },
        },
      },
      409,
    );
  }

  const sellable = priced.filter((line) => line.line_total_minor !== null);
  if (sellable.length === 0) {
    return json(
      req,
      { error: { message: 'None of the items in your cart can be purchased right now.', code: 'CART_CHANGED', details: { issues } } },
      409,
    );
  }

  const subtotalMinor = sellable.reduce((sum, line) => sum + (line.line_total_minor ?? 0), 0);
  const perItemShipping = sellable.reduce((sum, line) => sum + (line.shipping_minor ?? 0), 0);
  const hasPhysical = sellable.some((line) => !line.is_digital);
  const shippingTotalMinor = perItemShipping + (hasPhysical ? SHIPPING_UPLIFT_MINOR[shippingMethod] : 0);
  const totalMinor = subtotalMinor + shippingTotalMinor;

  if (totalMinor <= 0) {
    return fail(req, 409, 'That order total is not payable.');
  }

  /* ── Create the order ── */

  const { data: orderNumberRow, error: numberError } = await db.rpc('generate_order_number');
  if (numberError) {
    console.error('[create-order] order number failed:', numberError.message);
    return fail(req, 500, 'We could not start that order.');
  }

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      order_number: orderNumberRow as unknown as string,
      customer_id: profile.id,
      customer_email: profile.email,
      subtotal_minor: subtotalMinor,
      shipping_total_minor: shippingTotalMinor,
      discount_minor: 0,
      total_minor: totalMinor,
      currency: 'INR',
      shipping_address: shippingAddress,
      billing_address: body.billing_address ?? null,
      shipping_method: shippingMethod,
      customer_note: typeof body.customer_note === 'string' ? body.customer_note.slice(0, 1000) : '',
      status: 'pending_payment',
      idempotency_key: idempotencyKey || null,
    })
    .select('id, order_number, status, total_minor, currency')
    .single();

  if (orderError || !order) {
    // A unique-violation here means a concurrent duplicate won the race.
    if (orderError?.code === '23505' || orderError?.code === '23P01') {
      return fail(req, 409, 'That checkout is already in progress. Please wait a moment.', 'DUPLICATE_CHECKOUT');
    }
    console.error('[create-order] order insert failed:', orderError?.message);
    return fail(req, 500, 'We could not start that order.');
  }

  /* ── Order items, each with its commission snapshot ── */

  const { error: itemsError } = await db.from('order_items').insert(
    sellable.map((line) => ({
      order_id: order.id,
      artwork_id: line.artwork_id,
      artist_id: line.artist_id,
      artist_user_id: line.artist_user_id,
      title: line.title,
      quantity: line.quantity,
      unit_price_minor: line.unit_price_minor,
      line_total_minor: line.line_total_minor,
      shipping_minor: line.shipping_minor,
      // Frozen here, immutable thereafter (enforced by trigger).
      commission_rate_percent: line.commission_rate_percent,
      commission_basis_minor: line.commission_basis_minor,
      commission_minor: line.commission_minor,
      artist_earnings_minor: line.artist_earnings_minor,
      settlement_status: 'pending',
    })),
  );

  if (itemsError) {
    await db.from('orders').delete().eq('id', order.id);
    console.error('[create-order] items insert failed:', itemsError.message);
    return fail(req, 500, 'We could not start that order.');
  }

  /* ── Razorpay order ── */

  let gateway;
  try {
    gateway = await razorpay('POST', '/v1/orders', {
      amount: totalMinor,
      currency: 'INR',
      receipt: order.order_number,
      notes: { order_id: order.id, order_number: order.order_number },
    });
  } catch (err) {
    await db.from('orders').delete().eq('id', order.id);
    console.error('[create-order] gateway threw:', err);
    return fail(req, 502, 'The payment gateway could not be reached. Nothing has been charged.');
  }

  if (!gateway.ok) {
    // Do not leave an orphan order behind when the gateway refused us.
    await db.from('orders').delete().eq('id', order.id);
    console.error('[create-order] gateway refused:', JSON.stringify(gateway.data));
    return fail(req, 502, 'The payment gateway could not start this payment. Nothing has been charged.');
  }

  const { error: paymentError } = await db.from('payments').insert({
    order_id: order.id,
    customer_id: profile.id,
    provider: 'razorpay',
    provider_order_id: gateway.data.id as string,
    amount_minor: totalMinor,
    currency: 'INR',
    status: 'pending',
    provider_meta: { receipt: gateway.data.receipt, status: gateway.data.status },
  });

  if (paymentError) {
    console.error('[create-order] payment insert failed:', paymentError.message);
    return fail(req, 500, 'We could not record that payment attempt.');
  }

  await auditLog(db, {
    actor_id: profile.id,
    actor_role: profile.role,
    action: 'order.created',
    entity_type: 'order',
    entity_id: order.id,
    detail: { total_minor: totalMinor, items: sellable.length, provider_order_id: gateway.data.id },
  });

  return json(
    req,
    {
      order,
      payment: {
        provider: 'razorpay',
        // The Key ID is public by design; the secret never leaves this function.
        key_id: razorpayKeyId(),
        order_id: gateway.data.id,
        amount: totalMinor,
        currency: 'INR',
      },
      issues,
    },
    201,
  );
});
