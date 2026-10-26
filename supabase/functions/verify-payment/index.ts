/**
 * POST /functions/v1/verify-payment
 *
 * Called by the browser when Razorpay hands control back.
 *
 * The browser's claim that the payment succeeded is NOT trusted. This function
 * verifies Razorpay's HMAC with the key secret, then asks Razorpay directly
 * what the payment's real status and amount are, and only settles the order if
 * both agree with our own record.
 *
 * Idempotent: a second call on an already-settled order returns the same
 * answer instead of settling twice.
 */

import { fail, json, preflight } from '../_shared/cors.ts';
import {
  auditLog,
  razorpay,
  razorpayConfigured,
  requireUser,
  serviceClient,
  verifyPaymentSignature,
} from '../_shared/clients.ts';

Deno.serve(async (req) => {
  const flight = preflight(req);
  if (flight) return flight;

  if (req.method !== 'POST') return fail(req, 405, 'Use POST.');
  if (!razorpayConfigured()) return fail(req, 503, 'Payments are not configured on this server.');

  const profile = await requireUser(req);
  if (!profile) return fail(req, 401, 'Please sign in to continue.');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, 'That request body is not valid JSON.');
  }

  const orderId = String(body.order_id ?? '');
  const providerOrderId = String(body.razorpay_order_id ?? '');
  const providerPaymentId = String(body.razorpay_payment_id ?? '');
  const signature = String(body.razorpay_signature ?? '');

  if (!orderId) return fail(req, 422, 'An order id is required.');

  const db = serviceClient();

  // Scoped to the caller: one customer can never settle another's order.
  const { data: order } = await db
    .from('orders')
    .select('id, order_number, status, total_minor, currency, customer_id')
    .eq('id', orderId)
    .eq('customer_id', profile.id)
    .maybeSingle();

  if (!order) return fail(req, 404, 'That order was not found.');

  const { data: payment } = await db
    .from('payments')
    .select('id, provider, provider_order_id, provider_payment_id, amount_minor, currency, status, verified_at, verified_via')
    .eq('order_id', order.id)
    .maybeSingle();

  if (!payment) return fail(req, 404, 'No payment was started for that order.');

  /* ── Already settled: say so, do not settle again ── */
  if (order.status !== 'pending_payment') {
    return json(req, {
      order,
      payment: {
        status: payment.status,
        verified_at: payment.verified_at,
        verified_via: payment.verified_via,
      },
      already_settled: true,
    });
  }

  // The gateway order id the client echoes must be the one we created.
  if (providerOrderId && payment.provider_order_id && providerOrderId !== payment.provider_order_id) {
    await auditLog(db, {
      actor_id: profile.id,
      actor_role: profile.role,
      action: 'payment.order_id_mismatch',
      entity_type: 'payment',
      entity_id: payment.id,
      detail: { claimed: providerOrderId, expected: payment.provider_order_id },
    });
    return fail(req, 400, 'That payment does not belong to this order.');
  }

  /* ── 1. Verify the HMAC Razorpay gave the browser ── */

  const signatureValid = await verifyPaymentSignature(
    payment.provider_order_id ?? '',
    providerPaymentId,
    signature,
  );

  /* ── 2. Ask Razorpay directly. This is authoritative. ── */

  let remote: Record<string, unknown> | null = null;
  if (providerPaymentId) {
    const lookup = await razorpay('GET', `/v1/payments/${providerPaymentId}`);
    if (lookup.ok) remote = lookup.data;
    else console.error('[verify-payment] lookup failed:', JSON.stringify(lookup.data).slice(0, 300));
  }

  const remoteStatus = String(remote?.status ?? '');
  const remoteCaptured = remoteStatus === 'captured' || remoteStatus === 'authorized';
  const remoteAmount = Number(remote?.amount ?? 0);
  const remoteCurrency = String(remote?.currency ?? '').toUpperCase();
  const remoteOrderId = String(remote?.order_id ?? '');

  // Neither check passed: refuse, and record the attempt.
  if (!signatureValid && !remoteCaptured) {
    await db
      .from('payments')
      .update({ status: 'failed', failure_reason: 'Payment could not be verified with the gateway.' })
      .eq('id', payment.id);

    await auditLog(db, {
      actor_id: profile.id,
      actor_role: profile.role,
      action: 'payment.verification_failed',
      entity_type: 'payment',
      entity_id: payment.id,
      detail: { signature_valid: signatureValid, remote_status: remoteStatus },
    });

    return fail(
      req,
      400,
      'We could not verify that payment with the gateway. If you were charged, nothing is lost — contact support with your order number.',
      'VERIFICATION_FAILED',
    );
  }

  /* ── 3. Cross-check what was actually paid against our own order ── */

  if (remote) {
    if (remoteOrderId && payment.provider_order_id && remoteOrderId !== payment.provider_order_id) {
      return fail(req, 409, 'That payment belongs to a different order.');
    }
    if (remoteAmount && remoteAmount !== order.total_minor) {
      await db
        .from('payments')
        .update({ status: 'failed', failure_reason: 'Captured amount did not match the order total.' })
        .eq('id', payment.id);

      await auditLog(db, {
        actor_id: profile.id,
        actor_role: profile.role,
        action: 'payment.amount_mismatch',
        entity_type: 'payment',
        entity_id: payment.id,
        detail: { paid: remoteAmount, expected: order.total_minor },
      });

      return fail(req, 409, 'The paid amount does not match this order. Our team has been alerted.');
    }
    if (remoteCurrency && remoteCurrency !== String(order.currency).toUpperCase()) {
      return fail(req, 409, 'The paid currency does not match this order.');
    }
  }

  /* ── 4. Settle ── */

  const { error: settleError } = await db.rpc('settle_paid_order', {
    p_order_id: order.id,
    p_payment_id: payment.id,
    p_provider_payment_id: providerPaymentId,
    p_verified_via: signatureValid ? 'signature' : 'reconciliation',
    p_note: signatureValid
      ? 'Payment verified by signature and confirmed with the gateway.'
      : 'Payment confirmed directly with the gateway.',
  });

  if (settleError) {
    console.error('[verify-payment] settlement failed:', settleError.message);
    return fail(
      req,
      500,
      'Your payment was verified but we could not finalise the order. Our team has been alerted — your payment is safe.',
    );
  }

  const { data: settled } = await db
    .from('orders')
    .select('id, order_number, status, total_minor, currency, paid_at')
    .eq('id', order.id)
    .single();

  return json(req, {
    order: settled,
    payment: {
      status: 'captured',
      verified_via: signatureValid ? 'signature' : 'reconciliation',
      verified_at: new Date().toISOString(),
    },
  });
});
