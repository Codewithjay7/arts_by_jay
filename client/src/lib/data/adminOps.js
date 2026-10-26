import client, { unwrap, supabaseError } from '../supabase';
import { requireAdmin } from './session';

/**
 * Privileged admin operations: payouts, delivery confirmation, disputes,
 * audit and reconciliation.
 *
 * Everything here goes through an `admin_*` RPC that checks `is_admin()`
 * internally, because the underlying functions — `record_settlement`,
 * `confirm_delivery`, `apply_refund`, `open_dispute` — are REVOKEd from
 * browser roles entirely. An admin with a compromised session still cannot
 * move money directly from the browser; it has to go through a function that
 * re-checks who is asking.
 */

/* ═══════════════════════ Payout queue ═══════════════════════ */

/**
 * Every artist share and where it stands.
 *
 * `isPaid` is true only where a provider transfer or a recorded bank
 * reference exists. `eligible` means earned and clear to pay — never paid.
 * That distinction is the entire point of this screen: without it, a status
 * column becomes a fiction about money that has not moved.
 */
export const getPayoutQueue = async (status) => {
  const db = client();

  const { data, error } = await db.rpc('admin_payout_queue', { p_status: status ?? null });
  if (error) throw new Error(supabaseError(error, 'Could not load the payout queue.'));

  return {
    items: (data?.items ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      orderNumber: row.order_number,
      orderStatus: row.order_status,
      artistName: row.artist_name,
      artistSlug: row.artist_slug,
      artistUserId: row.artist_user_id,
      lineTotalMinor: row.line_total_minor,
      commissionRatePercent: row.commission_rate_percent,
      commissionMinor: row.commission_minor,
      earningsMinor: row.earnings_minor,
      refundedMinor: row.refunded_minor,
      fulfilmentStatus: row.fulfilment_status,
      deliveryConfirmedAt: row.delivery_confirmed_at,
      returnWindowEndsAt: row.return_window_ends_at,
      settlementStatus: row.settlement_status,
      settlementHoldReason: row.settlement_hold_reason,
      disputeOpen: row.dispute_open,
      createdAt: row.created_at,
      isPaid: row.is_paid,
      paidReference: row.paid_reference,
      paidOutOfBand: row.paid_out_of_band,
      hasLinkedAccount: row.has_linked_account,
    })),
    totals: {
      pendingMinor: data?.totals?.pending_minor ?? 0,
      eligibleMinor: data?.totals?.eligible_minor ?? 0,
      onHoldMinor: data?.totals?.on_hold_minor ?? 0,
      transferredMinor: data?.totals?.transferred_minor ?? 0,
      eligibleCount: data?.totals?.eligible_count ?? 0,
      currency: data?.totals?.currency ?? 'INR',
    },
  };
};

/** Confirms delivery, which starts the configured return window. */
export const confirmDelivery = async (orderItemId, { evidenceRef = '', note = '' } = {}) => {
  const db = client();

  const { data, error } = await db.rpc('admin_confirm_delivery', {
    p_order_item_id: orderItemId,
    p_evidence_ref: evidenceRef,
    p_note: note,
  });

  if (error) throw new Error(supabaseError(error, 'That delivery could not be confirmed.'));

  return {
    id: data?.id,
    deliveryConfirmedAt: data?.delivery_confirmed_at,
    returnWindowEndsAt: data?.return_window_ends_at,
    settlementStatus: data?.settlement_status,
  };
};

/**
 * Promotes every line whose return window has closed with no dispute or
 * refund. Idempotent, so running it twice is harmless.
 */
export const refreshEligibility = async () => {
  const db = client();

  const { data, error } = await db.rpc('admin_refresh_eligibility');
  if (error) throw new Error(supabaseError(error, 'The payout sweep could not be run.'));

  return { promoted: data?.promoted ?? 0 };
};

/**
 * Records that an artist has actually been paid.
 *
 * Demands evidence — a Razorpay Route transfer id, or a bank reference for a
 * manual transfer — and the database refuses without one. While Route is
 * unapproved the out-of-band path is the only honest option.
 */
export const recordSettlement = async (
  orderItemId,
  { providerTransferId = '', outOfBandReference = '', note = '' } = {},
) => {
  const db = client();

  const { data, error } = await db.rpc('admin_record_settlement', {
    p_order_item_id: orderItemId,
    p_provider_transfer_id: providerTransferId,
    p_out_of_band_reference: outOfBandReference,
    p_note: note,
  });

  if (error) throw new Error(supabaseError(error, 'That settlement could not be recorded.'));

  return {
    id: data?.id,
    amountMinor: data?.amount_minor,
    outOfBand: data?.out_of_band,
    reference: data?.reference,
    settledAt: data?.settled_at,
  };
};

export const openDispute = async (orderItemId, reason) => {
  const db = client();

  const { data, error } = await db.rpc('admin_open_dispute', {
    p_order_item_id: orderItemId,
    p_reason: reason,
  });

  if (error) throw new Error(supabaseError(error, 'That dispute could not be opened.'));
  return { id: data?.id, disputeOpen: data?.dispute_open, settlementStatus: data?.settlement_status };
};

export const resolveDispute = async (orderItemId, resolution) => {
  const db = client();

  const { data, error } = await db.rpc('admin_resolve_dispute', {
    p_order_item_id: orderItemId,
    p_resolution: resolution,
  });

  if (error) throw new Error(supabaseError(error, 'That dispute could not be resolved.'));
  return { id: data?.id, settlementStatus: data?.settlement_status };
};

/* ═══════════════════════ Audit and reconciliation ═══════════════════════ */

export const getAuditLog = async ({ limit = 100, entityType } = {}) => {
  const db = client();

  const { data, error } = await db.rpc('admin_audit_log', {
    p_limit: limit,
    p_entity_type: entityType ?? null,
  });

  if (error) throw new Error(supabaseError(error, 'Could not load the audit log.'));

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detail: row.detail,
      createdAt: row.created_at,
      actorRole: row.actor_role,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
    })),
  };
};

/**
 * Webhook deliveries, for reconciling against the gateway.
 *
 * The row worth looking at is an unprocessed one carrying an error: it means
 * a payment event arrived, passed signature verification, and then something
 * of ours failed. That is a dropped payment, not a gateway problem.
 */
export const getWebhookEvents = async ({ limit = 50, unprocessedOnly = false } = {}) => {
  await requireAdmin();
  const db = client();

  let query = db
    .from('webhook_events')
    .select(
      `id, provider, provider_event_id, event_type, signature_verified,
       processed_at, processing_error, attempts, received_at`,
    )
    .order('received_at', { ascending: false })
    .limit(limit);

  if (unprocessedOnly) query = query.is('processed_at', null);

  const rows = unwrap(await query, 'Could not load the webhook log');

  return {
    items: (rows ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      eventType: row.event_type,
      signatureVerified: row.signature_verified,
      processedAt: row.processed_at,
      processingError: row.processing_error,
      attempts: row.attempts,
      receivedAt: row.received_at,
    })),
  };
};

/** Payments needing a person: failed, disputed, or captured-but-unverified. */
export const getPaymentExceptions = async () => {
  await requireAdmin();
  const db = client();

  const rows = unwrap(
    await db
      .from('payments')
      .select(
        `id, provider, provider_order_id, provider_payment_id, status, amount_minor,
         currency, failure_reason, verified_at, verified_via, refunded_minor, created_at,
         order:orders ( order_number, status, total_minor, customer_email )`,
      )
      .or('status.eq.failed,status.eq.disputed')
      .order('created_at', { ascending: false })
      .limit(100),
    'Could not load the payment exceptions',
  );

  // A captured payment with no verified_at was never confirmed against the
  // gateway. Queried separately because PostgREST's `or` cannot express the
  // AND inside one of the branches.
  const unverified = unwrap(
    await db
      .from('payments')
      .select(
        `id, provider, provider_order_id, provider_payment_id, status, amount_minor,
         currency, failure_reason, verified_at, verified_via, refunded_minor, created_at,
         order:orders ( order_number, status, total_minor, customer_email )`,
      )
      .eq('status', 'captured')
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
  );

  const shape = (row) => ({
    id: row.id,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    status: row.status,
    amountMinor: row.amount_minor,
    currency: row.currency,
    failureReason: row.failure_reason,
    verifiedAt: row.verified_at,
    verifiedVia: row.verified_via,
    refundedMinor: row.refunded_minor,
    createdAt: row.created_at,
    order: row.order
      ? {
          orderNumber: row.order.order_number,
          status: row.order.status,
          totalMinor: row.order.total_minor,
          customerEmail: row.order.customer_email,
        }
      : null,
    needsReconciliation: row.status === 'captured' && !row.verified_at,
  });

  return { items: [...(rows ?? []), ...(unverified ?? [])].map(shape) };
};

/* ═══════════════════════ Reviews ═══════════════════════ */

export const listAllReviews = async ({ page = 1, limit = 20, hidden } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('reviews')
    .select(
      `id, rating, title, body, is_hidden, hidden_reason, created_at,
       artwork:artworks ( id, title, slug ),
       author:profiles ( id, full_name, email )`,
      { count: 'exact' },
    );

  if (hidden === 'true') query = query.eq('is_hidden', true);
  if (hidden === 'false') query = query.eq('is_hidden', false);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the reviews');

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      isHidden: row.is_hidden,
      hiddenReason: row.hidden_reason,
      createdAt: row.created_at,
      artwork: row.artwork ? { id: row.artwork.id, title: row.artwork.title, slug: row.artwork.slug } : null,
      author: row.author ? { name: row.author.full_name, email: row.author.email } : null,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

export const deleteReview = async (id) => {
  const db = client();
  unwrap(await db.from('reviews').delete().eq('id', id), 'That review could not be deleted');
  return { ok: true };
};

/* ═══════════════════════ Enquiries ═══════════════════════ */

export const listAllEnquiries = async ({ page = 1, limit = 20, status, kind } = {}) => {
  await requireAdmin();
  const db = client();
  const from = (page - 1) * limit;

  let query = db
    .from('commission_requests')
    .select(
      `id, reference, kind, status, subject, message, contact_name, contact_email,
       quoted_amount_minor, budget_minor, created_at,
       artist:artist_profiles ( id, display_name, slug ),
       artwork:artworks ( id, title, slug )`,
      { count: 'exact' },
    );

  if (status) query = query.eq('status', status);
  if (kind) query = query.eq('kind', kind);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  unwrap({ data, error }, 'Could not load the enquiries');

  const total = count ?? 0;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      reference: row.reference,
      kind: row.kind,
      status: row.status,
      subject: row.subject,
      message: row.message,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      quotedAmountMinor: row.quoted_amount_minor,
      budgetMinor: row.budget_minor,
      createdAt: row.created_at,
      artist: row.artist ? { displayName: row.artist.display_name, slug: row.artist.slug } : null,
      artwork: row.artwork ? { title: row.artwork.title, slug: row.artwork.slug } : null,
    })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: from + limit < total },
  };
};

/* ═══════════════════════ Linked accounts ═══════════════════════ */

/**
 * Razorpay Route linked accounts.
 *
 * Read-only from the dashboard, deliberately: `artist_accounts` has no write
 * policy for any browser role, because changing `provider_account_id` would
 * redirect another artist's money. Onboarding runs server-side.
 */
export const listLinkedAccounts = async () => {
  await requireAdmin();
  const db = client();

  const rows = unwrap(
    await db
      .from('artist_accounts')
      .select(
        `id, provider, provider_account_id, status, payouts_enabled, requirements,
         status_detail, onboarding_started_at, activated_at, created_at,
         artist:artist_profiles ( id, display_name, slug )`,
      )
      .order('created_at', { ascending: false }),
    'Could not load the linked accounts',
  );

  return {
    items: (rows ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      status: row.status,
      payoutsEnabled: row.payouts_enabled,
      requirements: row.requirements ?? [],
      statusDetail: row.status_detail,
      onboardingStartedAt: row.onboarding_started_at,
      activatedAt: row.activated_at,
      artist: row.artist ? { displayName: row.artist.display_name, slug: row.artist.slug } : null,
    })),
  };
};
