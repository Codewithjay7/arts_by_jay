/**
 * Checkout: placing an order and confirming its payment.
 *
 * This is the only part of the data layer that does not talk to PostgREST.
 * Creating an order and verifying a payment both need the Razorpay key
 * SECRET, which must never reach a browser, so both live in Edge Functions
 * and this module invokes them.
 *
 * What the browser sends is deliberately thin: a shipping address, a shipping
 * method and an idempotency key. It does NOT send prices, totals, commission
 * or the artist's share. Those are recomputed from the database inside
 * create-order, because a total that arrives from the client is a total an
 * attacker can choose.
 *
 * Replaces the Express `/api/checkout` and `/api/payments/*` routes. Those
 * calls were worse than broken on the deployed site: Netlify rewrites any
 * unknown path to index.html with HTTP 200, so axios resolved successfully
 * with a page of HTML as its payload and the checkout page read fields off
 * it that were never there. A failure that returns 200 is the hardest kind
 * to see.
 */

import client, { supabaseError } from '../supabase';
import { SHIPPING_METHODS } from './cart';

/** Maps the form's camelCase address onto the columns the function expects. */
const toAddressPayload = (address) => ({
  full_name: address.fullName?.trim() ?? '',
  phone: address.phone?.trim() ?? '',
  line1: address.line1?.trim() ?? '',
  line2: address.line2?.trim() ?? '',
  city: address.city?.trim() ?? '',
  state: address.state?.trim() ?? '',
  postal_code: address.postalCode?.trim() ?? '',
  country: address.country?.trim() ?? 'India',
  landmark: address.landmark?.trim() ?? '',
});

/**
 * Reads the error out of a failed `functions.invoke`.
 *
 * The SDK gives a FunctionsHttpError whose real body is only on the
 * `context` Response, so the function's own message ("Online payment is not
 * configured on this server yet") is lost unless it is read back out. Showing
 * "Edge Function returned a non-2xx status code" to a customer about to pay
 * would tell them nothing.
 */
const invokeError = async (error, fallback) => {
  const response = error?.context;

  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json();
      const message = body?.error?.message ?? body?.message;
      if (message) {
        const wrapped = new Error(message);
        wrapped.code = body?.error?.code ?? body?.code;
        wrapped.status = response.status;
        return wrapped;
      }
    } catch {
      // Not JSON. Fall through to the generic message below.
    }
  }

  const wrapped = new Error(supabaseError(error, fallback));
  wrapped.status = response?.status;
  return wrapped;
};

/**
 * Creates the order and the gateway order to pay for it.
 *
 * Returns { order, payment, issues }. `issues` lists anything that was
 * dropped from the cart (sold out, unpublished) so the page can say what
 * changed rather than silently charging for less than was shown.
 */
export const createOrder = async ({
  shippingAddress,
  billingAddress = null,
  shippingMethod = 'standard',
  customerNote = '',
  idempotencyKey,
}) => {
  const db = client();

  const { data, error } = await db.functions.invoke('create-order', {
    body: {
      shipping_address: toAddressPayload(shippingAddress),
      billing_address: billingAddress ? toAddressPayload(billingAddress) : null,
      shipping_method: shippingMethod,
      customer_note: customerNote ?? '',
      // Lets a retry re-attach to the order already created rather than
      // making a second one and charging twice.
      idempotency_key: idempotencyKey,
    },
  });

  if (error) throw await invokeError(error, 'We could not start that payment. Nothing has been charged.');

  return {
    order: {
      id: data.order.id,
      orderNumber: data.order.order_number,
      status: data.order.status,
      totalMinor: data.order.total_minor,
      currency: data.order.currency,
    },
    payment: {
      provider: data.payment.provider,
      keyId: data.payment.key_id,
      // `orderId` is the GATEWAY's order id, and the name matters: this
      // object is handed straight to paymentGateways, which reads
      // `payment.orderId` for Razorpay's `order_id`. Calling it
      // providerOrderId here leaves that undefined and the checkout opens
      // against no order at all.
      orderId: data.payment.order_id,
      amountMinor: data.payment.amount,
      currency: data.payment.currency,
    },
    issues: data.issues ?? [],
  };
};

/**
 * Confirms a payment. The gateway's word is not enough.
 *
 * Razorpay's checkout callback runs in the browser, where its values can be
 * edited, so nothing is trusted until verify-payment has recomputed the HMAC
 * signature with the key secret. Only the function's answer marks an order
 * paid.
 */
export const confirmPayment = async ({ orderId, providerOrderId, providerPaymentId, signature }) => {
  const db = client();

  const { data, error } = await db.functions.invoke('verify-payment', {
    body: {
      order_id: orderId,
      razorpay_order_id: providerOrderId,
      razorpay_payment_id: providerPaymentId,
      razorpay_signature: signature,
    },
  });

  if (error) {
    throw await invokeError(
      error,
      'We could not confirm that payment. Do not pay again — check your orders, and contact us if it is not there.',
    );
  }

  return {
    order: {
      id: data.order.id,
      orderNumber: data.order.order_number,
      status: data.order.status,
      totalMinor: data.order.total_minor,
      currency: data.order.currency,
      paidAt: data.order.paid_at,
    },
    payment: {
      status: data.payment.status,
      verifiedVia: data.payment.verified_via,
      verifiedAt: data.payment.verified_at,
    },
  };
};

/**
 * Abandons an unpaid order, so its stock is not held.
 *
 * Uses the same cancel_my_order RPC the account page uses, which only touches
 * orders the caller owns and refuses one that has been paid. Best effort by
 * design: the caller is on their way out, and the settlement sweep releases
 * abandoned orders anyway.
 */
export const cancelPendingOrder = async (orderNumber, reason = 'Payment window closed') => {
  if (!orderNumber) return;
  await client()
    .rpc('cancel_my_order', { p_order_number: orderNumber, p_reason: reason })
    .then(() => {})
    .catch(() => {});
};

export { SHIPPING_METHODS };
