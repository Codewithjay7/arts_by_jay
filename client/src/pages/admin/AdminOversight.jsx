import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Link2,
  MessageSquare,
  ScrollText,
  Star,
  Trash2,
  Webhook,
} from 'lucide-react';
import {
  getAuditLog,
  getWebhookEvents,
  getPaymentExceptions,
  listAllReviews,
  deleteReview,
  listAllEnquiries,
  listLinkedAccounts,
} from '../../lib/data/adminOps';
import { hideReview, updatePlatformSetting, getPlatformSettings } from '../../lib/data/admin';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  NoticeBanner,
  Pagination,
  SectionHeader,
  Select,
  StatCard,
  Stars,
} from '../../components/ui';
import { formatDateTime, formatMoney, formatRelative, statusLabel, statusTone } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { useUi } from '../../store/ui';

/* ═══════════════════════ Reconciliation ═══════════════════════ */

/**
 * Where payment reality and our records are compared.
 *
 * Three things matter here, in order of urgency:
 *   1. a captured payment with no `verified_at` — money taken, order never
 *      settled, customer waiting
 *   2. a verified webhook that failed to process — our bug, not the gateway's
 *   3. failed payments, which are usually just declined cards
 */
export const AdminReconciliationPage = () => {
  useDocumentTitle('Reconciliation');

  const [unprocessedOnly, setUnprocessedOnly] = useState(false);

  const webhooks = useQuery({
    queryKey: ['admin-webhooks', unprocessedOnly],
    queryFn: () => getWebhookEvents({ limit: 60, unprocessedOnly }),
  });

  const payments = useQuery({ queryKey: ['admin-payment-exceptions'], queryFn: getPaymentExceptions });

  if (webhooks.isLoading || payments.isLoading) return <LoadingBlock label="Loading reconciliation" />;

  if (webhooks.isError) return <ErrorState message={webhooks.error?.message} onRetry={webhooks.refetch} />;

  const exceptions = payments.data?.items ?? [];
  const stuck = exceptions.filter((item) => item.needsReconciliation);
  const failedWebhooks = (webhooks.data?.items ?? []).filter(
    (event) => !event.processedAt && event.processingError,
  );

  return (
    <div className="space-y-9">
      <SectionHeader
        eyebrow="Payments"
        title="Reconciliation"
        description="Where the gateway's record and ours are compared. An unexplained difference belongs here, not in a customer's inbox."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Captured but unverified"
          value={stuck.length}
          sublabel="money taken, order not settled"
          tone={stuck.length > 0 ? 'accent' : 'neutral'}
        />
        <StatCard
          label="Webhooks that failed to process"
          value={failedWebhooks.length}
          sublabel="verified, then our side errored"
        />
        <StatCard
          label="Failed payments"
          value={exceptions.filter((item) => item.status === 'failed').length}
          sublabel="usually a declined card"
        />
      </div>

      {stuck.length > 0 && (
        <NoticeBanner tone="warning" title={`${stuck.length} payment(s) were captured but never verified`}>
          The gateway took the money and our server never confirmed it, so the order was not settled and
          the customer has nothing. Check each against the Razorpay dashboard. A re-delivered webhook will
          settle it automatically, because settlement is idempotent.
        </NoticeBanner>
      )}

      {/* ── Payment exceptions ── */}
      <section aria-labelledby="exceptions-heading">
        <h2 id="exceptions-heading" className="eyebrow mb-4">
          Payment exceptions
        </h2>

        {!exceptions.length ? (
          <EmptyState
            icon={Check}
            title="Nothing to reconcile"
            message="Every payment is either verified and settled, or cleanly failed."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-[0.875rem]">
              <thead>
                <tr className="border-b border-line">
                  {['Order', 'Status', 'Amount', 'Gateway reference', 'Why', 'When'].map((h) => (
                    <th key={h} scope="col" className="py-3 pr-4 text-[0.75rem] font-medium text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exceptions.map((item) => (
                  <tr
                    key={item.id}
                    className={clsx('border-b border-line', item.needsReconciliation && 'bg-amber-50')}
                  >
                    <td className="py-3 pr-4">
                      <p className="font-mono text-[0.82rem]">{item.order?.orderNumber ?? '—'}</p>
                      <p className="text-[0.78rem] text-muted">{item.order?.customerEmail}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={item.status === 'failed' ? 'negative' : 'warning'}>{item.status}</Badge>
                        {item.needsReconciliation && <Badge tone="accent">Needs checking</Badge>}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-medium">{formatMoney(item.amountMinor, item.currency)}</td>
                    <td className="py-3 pr-4 font-mono text-[0.76rem] text-muted">
                      {item.providerPaymentId || item.providerOrderId || '—'}
                    </td>
                    <td className="max-w-[18rem] py-3 pr-4 text-[0.8rem] text-muted">
                      {item.needsReconciliation
                        ? 'Captured, but never confirmed with the gateway.'
                        : item.failureReason || '—'}
                    </td>
                    <td className="py-3 text-[0.8rem] text-muted">{formatRelative(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Webhook log ── */}
      <section aria-labelledby="webhooks-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 id="webhooks-heading" className="eyebrow">
            Webhook deliveries
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setUnprocessedOnly((value) => !value)}>
            <Webhook className="h-3.5 w-3.5" aria-hidden="true" />
            {unprocessedOnly ? 'Show all' : 'Unprocessed only'}
          </Button>
        </div>

        {!webhooks.data?.items?.length ? (
          <EmptyState
            icon={Webhook}
            title="No webhook deliveries yet"
            message="Razorpay has not called this project, or the webhook URL and secret have not been configured."
          />
        ) : (
          <ul className="space-y-2">
            {webhooks.data.items.map((event) => (
              <li
                key={event.id}
                className={clsx(
                  'flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 text-[0.85rem]',
                  event.processingError ? 'border-red-200 bg-red-50' : 'border-line bg-surface-0',
                )}
              >
                <Badge tone={event.processedAt ? 'positive' : event.processingError ? 'negative' : 'warning'}>
                  {event.processedAt ? 'processed' : event.processingError ? 'failed' : 'pending'}
                </Badge>
                <span className="font-medium">{event.eventType}</span>
                <span className="font-mono text-[0.76rem] text-muted">{event.providerEventId}</span>
                {!event.signatureVerified && <Badge tone="negative">Signature not verified</Badge>}
                {event.processingError && (
                  <span className="w-full text-[0.8rem] text-red-700">{event.processingError}</span>
                )}
                <span className="ml-auto text-[0.78rem] text-muted">{formatRelative(event.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/* ═══════════════════════ Audit trail ═══════════════════════ */

export const AdminAuditPage = () => {
  useDocumentTitle('Audit log');

  const [entityType, setEntityType] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-audit', entityType],
    queryFn: () => getAuditLog({ limit: 200, entityType: entityType || undefined }),
  });

  if (isLoading) return <LoadingBlock label="Loading the audit log" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Accountability"
          title="Audit log"
          description="Append-only. Settlements, refunds, delivery confirmations, disputes and moderation decisions, with who did them."
        />
        <Select
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          aria-label="Filter by entity"
          className="w-auto min-w-[12rem]"
        >
          <option value="">Everything</option>
          <option value="order">Orders</option>
          <option value="order_item">Order items</option>
          <option value="refund">Refunds</option>
          <option value="order_items">Settlement sweeps</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing recorded yet"
          message="Privileged actions are written here as they happen."
        />
      ) : (
        <ol className="space-y-2">
          {data.items.map((entry) => (
            <li key={entry.id} className="rounded-card border border-line bg-surface-0 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[0.8rem] font-medium text-accent-300">{entry.action}</span>
                {entry.actorRole && <Badge>{entry.actorRole}</Badge>}
                <span className="text-[0.82rem] text-muted">
                  {entry.actorName || entry.actorEmail || 'system'}
                </span>
                <span className="ml-auto text-[0.78rem] text-muted">{formatDateTime(entry.createdAt)}</span>
              </div>

              {entry.detail && Object.keys(entry.detail).length > 0 && (
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.78rem]">
                  {Object.entries(entry.detail).map(([key, value]) => (
                    <div key={key} className="flex gap-1.5">
                      <dt className="text-muted">{key.replace(/_/g, ' ')}:</dt>
                      <dd className="font-mono text-ink">
                        {/* Money keys are paise; render them as currency. */}
                        {key.endsWith('_minor') && typeof value === 'number'
                          ? formatMoney(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/* ═══════════════════════ Reviews ═══════════════════════ */

export const AdminReviewsPage = () => {
  useDocumentTitle('Reviews');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [hidden, setHidden] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-reviews', hidden, page],
    queryFn: () => listAllReviews({ hidden: hidden || undefined, page, limit: 20 }),
    placeholderData: (previous) => previous,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isHidden }) => hideReview(id, { isHidden, reason: isHidden ? 'Hidden by a moderator.' : '' }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      success(variables.isHidden ? 'Review hidden' : 'Review restored');
    },
    onError: (err) => failure('Not changed', err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      success('Review deleted');
    },
    onError: (err) => failure('Not deleted', err.message),
  });

  if (isLoading) return <LoadingBlock label="Loading the reviews" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Content"
          title="Reviews"
          description="Every review is from a verified buyer whose order was delivered — the database enforces that on insert."
        />
        <Select
          value={hidden}
          onChange={(event) => {
            setHidden(event.target.value);
            setPage(1);
          }}
          aria-label="Filter reviews"
          className="w-auto min-w-[11rem]"
        >
          <option value="">All reviews</option>
          <option value="false">Visible</option>
          <option value="true">Hidden</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState icon={Star} title="No reviews yet" message="A buyer can review once their order is delivered." />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((review) => (
              <li key={review.id} className="panel space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Stars value={review.rating} />
                      {review.isHidden && <Badge tone="negative">Hidden</Badge>}
                    </div>
                    {review.artwork && (
                      <Link
                        to={`/art/${review.artwork.slug}`}
                        className="block text-[1rem] font-medium hover:text-accent-300"
                      >
                        {review.artwork.title}
                      </Link>
                    )}
                    <p className="text-[0.8rem] text-muted">
                      {review.author?.name} · {review.author?.email} · {formatRelative(review.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggle.mutate({ id: review.id, isHidden: !review.isHidden })}
                    >
                      {review.isHidden ? (
                        <>
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                          Hide
                        </>
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(review.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {review.title && <p className="font-medium">{review.title}</p>}
                {review.body && <p className="text-[0.9rem] leading-relaxed text-muted">{review.body}</p>}
                {review.hiddenReason && (
                  <p className="text-[0.8rem] text-amber-700">Hidden: {review.hiddenReason}</p>
                )}
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
};

/* ═══════════════════════ Enquiries ═══════════════════════ */

export const AdminEnquiriesPage = () => {
  useDocumentTitle('Enquiries');

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-enquiries', status, page],
    queryFn: () => listAllEnquiries({ status: status || undefined, page, limit: 20 }),
    placeholderData: (previous) => previous,
  });

  if (isLoading) return <LoadingBlock label="Loading the enquiries" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Oversight"
          title="Commissions and enquiries"
          description="Every brief across the marketplace, including those sent to a specific artist."
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="w-auto min-w-[11rem]"
        >
          <option value="">All</option>
          {['new', 'in_review', 'quoted', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled'].map(
            (entry) => (
              <option key={entry} value={entry}>
                {statusLabel(entry)}
              </option>
            ),
          )}
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState icon={MessageSquare} title="No enquiries" message="Commission briefs appear here as they arrive." />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((item) => (
              <li key={item.id} className="panel space-y-2.5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-mono text-[0.76rem] text-muted">{item.reference}</p>
                    <h3 className="text-[1.05rem] font-medium">{item.subject || 'Commission enquiry'}</h3>
                    <p className="text-[0.82rem] text-muted">
                      {item.contactName} · {item.contactEmail}
                      {item.artist ? ` · to ${item.artist.displayName}` : ' · unassigned'}
                      {' · '}
                      {formatRelative(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.kind === 'photo_to_art' && <Badge tone="info">From the studio</Badge>}
                    <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                  </div>
                </div>

                <p className="line-clamp-3 text-[0.88rem] leading-relaxed text-muted">{item.message}</p>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8rem] text-muted">
                  {item.budgetMinor != null && <span>Budget {formatMoney(item.budgetMinor)}</span>}
                  {item.quotedAmountMinor != null && (
                    <span className="text-accent-300">Quoted {formatMoney(item.quotedAmountMinor)}</span>
                  )}
                  {item.artwork && <span>About &ldquo;{item.artwork.title}&rdquo;</span>}
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
};

/* ═══════════════════════ Linked accounts ═══════════════════════ */

export const AdminLinkedAccountsPage = () => {
  useDocumentTitle('Linked accounts');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-linked-accounts'],
    queryFn: listLinkedAccounts,
  });

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getPlatformSettings });
  const routeEnabled = settings.data?.payments?.routeEnabled === true;

  if (isLoading) return <LoadingBlock label="Loading the linked accounts" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Razorpay Route"
        title="Linked accounts"
        description="An artist needs an activated linked account before the gateway can transfer their share directly."
      />

      {!routeEnabled && (
        <NoticeBanner tone="warning" title="Route is not enabled on this Razorpay account">
          Linked accounts cannot be created until Razorpay approves Route for your business. Until then,
          artist payouts are recorded as bank transfers on the Payouts screen. Razorpay&apos;s published
          thresholds are ₹40 lakh domestic or ₹5 lakh export turnover, plus a payer–payee transparency
          declaration — confirm the current terms with them.
        </NoticeBanner>
      )}

      {!data?.items?.length ? (
        <EmptyState
          icon={Link2}
          title="No linked accounts"
          message={
            routeEnabled
              ? 'No artist has started Route onboarding yet.'
              : 'None can exist while Route is disabled.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((account) => (
            <li key={account.id} className="panel flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">{account.artist?.displayName ?? 'Unknown artist'}</p>
                <p className="font-mono text-[0.78rem] text-muted">
                  {account.providerAccountId || 'no provider account yet'}
                </p>
                {account.statusDetail && <p className="text-[0.8rem] text-muted">{account.statusDetail}</p>}
                {account.requirements?.length > 0 && (
                  <p className="inline-flex items-start gap-1.5 text-[0.8rem] text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Outstanding: {account.requirements.join(', ')}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge tone={account.status === 'activated' ? 'positive' : 'warning'}>{account.status}</Badge>
                <Badge tone={account.payoutsEnabled ? 'positive' : 'neutral'}>
                  {account.payoutsEnabled ? 'payouts enabled' : 'payouts off'}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ═══════════════════════ Editable settings ═══════════════════════ */

export const AdminSettingsPage = () => {
  useDocumentTitle('Settings');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: getPlatformSettings,
  });

  const [draft, setDraft] = useState({});

  const save = useMutation({
    mutationFn: ({ key, value }) => updatePlatformSetting(key, value),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['capabilities'] });
      setDraft((current) => ({ ...current, [variables.key]: undefined }));
      success('Setting saved', 'It applies to new orders only — existing orders keep their snapshot.');
    },
    onError: (err) => failure('Not saved', err.message),
  });

  if (isLoading) return <LoadingBlock label="Loading the settings" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  const commission = data.payments.commissionPercent;
  const returnWindow = data.returnWindowDays;

  return (
    <div className="max-w-2xl space-y-9">
      <SectionHeader
        eyebrow="Configuration"
        title="Platform settings"
        description="What this deployment is configured to do, and the two values you can change."
      />

      {/* The guarantee that makes the commission rate safe to edit. */}
      <NoticeBanner tone="info" title="Changes apply to future orders only">
        Every order item stores a snapshot of the commission rate that applied when it was placed, and a
        database trigger refuses to alter it — including for the service role. So changing the rate below
        cannot rewrite what any artist was already owed.
      </NoticeBanner>

      <section className="space-y-5" aria-labelledby="editable-heading">
        <h2 id="editable-heading" className="eyebrow">
          Editable
        </h2>

        <Field
          label="Platform commission (%)"
          htmlFor="setting-commission"
          hint="Taken from the artwork subtotal only, never from shipping."
        >
          <div className="flex gap-2.5">
            <Input
              id="setting-commission"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={draft.commission_percent ?? commission}
              onChange={(event) => setDraft({ ...draft, commission_percent: event.target.value })}
            />
            <Button
              variant="secondary"
              onClick={() => save.mutate({ key: 'commission_percent', value: draft.commission_percent })}
              disabled={draft.commission_percent === undefined || Number(draft.commission_percent) === commission}
              loading={save.isPending}
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Shows the arithmetic at the chosen rate, so the effect is concrete. */}
        <div className="rounded-card bg-surface-100 px-4 py-3 text-[0.85rem]">
          <p className="text-muted">On a ₹2,000 artwork at {draft.commission_percent ?? commission}%:</p>
          <p className="mt-1">
            platform {formatMoney(Math.round((200000 * Number(draft.commission_percent ?? commission)) / 100))}
            {' · artist '}
            <span className="font-medium">
              {formatMoney(200000 - Math.round((200000 * Number(draft.commission_percent ?? commission)) / 100))}
            </span>
          </p>
        </div>

        <Field
          label="Return window (days)"
          htmlFor="setting-window"
          hint="Days after confirmed delivery before an artist's share becomes payable."
        >
          <div className="flex gap-2.5">
            <Input
              id="setting-window"
              type="number"
              min={0}
              max={90}
              value={draft.return_window_days ?? returnWindow}
              onChange={(event) => setDraft({ ...draft, return_window_days: event.target.value })}
            />
            <Button
              variant="secondary"
              onClick={() => save.mutate({ key: 'return_window_days', value: draft.return_window_days })}
              disabled={draft.return_window_days === undefined || Number(draft.return_window_days) === returnWindow}
              loading={save.isPending}
            >
              Save
            </Button>
          </div>
        </Field>
      </section>

      <section className="space-y-4" aria-labelledby="readonly-heading">
        <h2 id="readonly-heading" className="eyebrow">
          Controlled by deployment configuration
        </h2>

        <dl className="divide-y divide-line border-y border-line">
          <SettingRow label="Payment provider" value={data.payments.provider} />
          <SettingRow label="Currency" value={data.payments.currency} />
          <SettingRow
            label="Razorpay Route (split payouts)"
            value={data.payments.routeEnabled ? 'Enabled' : 'Not enabled'}
            tone={data.payments.routeEnabled ? 'positive' : 'warning'}
          />
          <SettingRow label="Image storage" value="Supabase Storage" tone="positive" />
          <SettingRow label="Database" value="Supabase PostgreSQL" tone="positive" />
          <SettingRow
            label="AI photo generation"
            value={data.features.aiPhotoStudio ? 'Configured' : 'Not configured — previews only'}
          />
          <SettingRow
            label="Email delivery"
            value={data.features.emailDelivery ? 'Configured' : 'Not configured — in-app only'}
            tone={data.features.emailDelivery ? 'positive' : 'warning'}
          />
        </dl>

        <p className="text-[0.82rem] leading-relaxed text-muted">{data.note}</p>
      </section>
    </div>
  );
};

const SettingRow = ({ label, value, tone }) => (
  <div className="flex items-center justify-between gap-4 py-3.5">
    <dt className="text-[0.9rem] text-muted">{label}</dt>
    <dd>{tone ? <Badge tone={tone}>{value}</Badge> : <span className="text-[0.9rem]">{value}</span>}</dd>
  </div>
);
