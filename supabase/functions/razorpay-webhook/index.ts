/**
 * POST /functions/v1/razorpay-webhook
 *
 * The authoritative settlement path. Razorpay calls this; a browser never does.
 *
 * Three things make it safe:
 *   1. The signature is computed over the EXACT RAW BYTES Razorpay signed, so
 *      the body is never parsed before it is trusted.
 *   2. Every delivery is recorded in `webhook_events` behind a unique index on
 *      (provider, provider_event_id), so a replay cannot settle twice.
 *   3. Settlement itself is idempotent: it only moves `pending_payment`
 *      orders forward.
 *
 * `verify_jwt = false` in config.toml, because Razorpay carries no Supabase
 * session. The HMAC is the authentication.
 */

import { razorpay, serviceClient, verifyWebhookSignature } from '../_shared/clients.ts';

const EVENT_MAP: Record<string, string> = {
  'payment.captured': 'payment_succeeded',
  'payment.authorized': 'payment_succeeded',
  'payment.failed': 'payment_failed',
  'refund.processed': 'refund_succeeded',
  'refund.failed': 'refund_failed',
};

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok({ received: false, reason: 'method' }, 405);

  // Raw bytes first. Parsing before verifying would be the whole bug.
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const signature = req.headers.get('x-razorpay-signature');

  const verified = await verifyWebhookSignature(rawBody, signature);
  if (!verified) {
    // A bad signature is a misconfiguration or a forgery. Never act on it.
    console.warn('[webhook] rejected an unverified delivery');
    return ok({ received: false }, 400);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return ok({ received: false, reason: 'unparseable' }, 400);
  }

  const db = serviceClient();

  const eventType = String(event.event ?? '');
  const entity =
    ((event.payload as Record<string, Record<string, Record<string, unknown>>>)?.payment?.entity ??
      (event.payload as Record<string, Record<string, Record<string, unknown>>>)?.refund?.entity ??
      {}) as Record<string, unknown>;

  const providerEventId = String(event.id ?? `${eventType}:${entity.id ?? ''}`);

  /* ── Idempotency ──
     The unique index does the real work: a replayed delivery collides and we
     stop. We acknowledge 200 so Razorpay stops retrying. */
  const { error: ledgerError } = await db.from('webhook_events').insert({
    provider: 'razorpay',
    provider_event_id: providerEventId,
    event_type: eventType,
    signature_verified: true,
    payload: event,
  });

  if (ledgerError) {
    if (ledgerError.code === '23505') {
      return ok({ received: true, duplicate: true });
    }
    console.error('[webhook] could not record event:', ledgerError.message);
    return ok({ received: false }, 500);
  }

  const mapped = EVENT_MAP[eventType] ?? 'ignored';

  if (mapped === 'ignored') {
    await db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider_event_id', providerEventId);
    return ok({ received: true, ignored: eventType });
  }

  try {
    const providerPaymentId = String(entity.payment_id ?? entity.id ?? '');
    const providerOrderId = String(entity.order_id ?? '');
    const amountMinor = Number(entity.amount ?? 0);

    // Match on either reference, since refunds carry payment_id and payments
    // carry order_id.
    const { data: payment } = await db
      .from('payments')
      .select('id, order_id, amount_minor, currency, status, provider_order_id')
      .or(
        [
          providerOrderId ? `provider_order_id.eq.${providerOrderId}` : null,
          providerPaymentId ? `provider_payment_id.eq.${providerPaymentId}` : null,
        ]
          .filter(Boolean)
          .join(','),
      )
      .maybeSingle();

    if (!payment) {
      await db
        .from('webhook_events')
        .update({
          processed_at: new Date().toISOString(),
          processing_error: 'No matching payment record.',
        })
        .eq('provider_event_id', providerEventId);

      console.warn('[webhook] no payment matched', providerOrderId, providerPaymentId);
      return ok({ received: true, matched: false });
    }

    const { data: order } = await db
      .from('orders')
      .select('id, order_number, status, total_minor, currency')
      .eq('id', payment.order_id)
      .single();

    if (!order) return ok({ received: true, matched: false });

    /* ── Payment succeeded ── */
    if (mapped === 'payment_succeeded') {
      // Amount tampering check against OUR order, not against the event.
      if (amountMinor && amountMinor !== order.total_minor) {
        await db
          .from('payments')
          .update({ status: 'failed', failure_reason: 'Webhook amount did not match the order total.' })
          .eq('id', payment.id);

        await db.from('audit_logs').insert({
          action: 'webhook.amount_mismatch',
          entity_type: 'payment',
          entity_id: payment.id,
          detail: { paid: amountMinor, expected: order.total_minor, order_number: order.order_number },
        });

        console.error('[webhook] amount mismatch on', order.order_number);
      } else {
        // Confirm with Razorpay rather than trusting even a signed event.
        let confirmed = true;
        if (providerPaymentId) {
          const lookup = await razorpay('GET', `/v1/payments/${providerPaymentId}`);
          const status = String(lookup.data?.status ?? '');
          confirmed = lookup.ok && (status === 'captured' || status === 'authorized');
        }

        if (confirmed) {
          const { error: settleError } = await db.rpc('settle_paid_order', {
            p_order_id: order.id,
            p_payment_id: payment.id,
            p_provider_payment_id: providerPaymentId,
            p_verified_via: 'webhook',
            p_note: 'Payment verified via gateway webhook.',
          });
          if (settleError) throw new Error(settleError.message);
        } else {
          console.warn('[webhook] gateway did not confirm capture for', providerPaymentId);
        }
      }
    }

    /* ── Payment failed ── */
    if (mapped === 'payment_failed') {
      await db
        .from('payments')
        .update({
          status: 'failed',
          provider_payment_id: providerPaymentId || null,
          failure_reason: String(entity.error_description ?? 'The gateway reported a failed payment.'),
        })
        .eq('id', payment.id);
    }

    /* ── Refund processed ── */
    if (mapped === 'refund_succeeded') {
      const { error: refundError } = await db.rpc('apply_refund', {
        p_payment_id: payment.id,
        p_amount_minor: amountMinor || payment.amount_minor,
        p_provider_refund_id: String(entity.id ?? ''),
        p_reason: String(entity.notes ?? ''),
      });
      if (refundError) throw new Error(refundError.message);
    }

    if (mapped === 'refund_failed') {
      await db
        .from('refunds')
        .update({ status: 'failed', provider_status: 'failed' })
        .eq('provider_refund_id', String(entity.id ?? ''));
    }

    await db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider_event_id', providerEventId);

    return ok({ received: true, processed: mapped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[webhook] processing failed:', message);

    // Record the failure and still acknowledge, so Razorpay does not retry
    // forever on a bug of ours. The row stays unprocessed for reconciliation.
    await db
      .from('webhook_events')
      .update({ processing_error: message.slice(0, 500) })
      .eq('provider_event_id', providerEventId);

    return ok({ received: true, processed: false });
  }
});
