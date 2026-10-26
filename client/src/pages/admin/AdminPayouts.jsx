import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Check, PackageCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  getPayoutQueue,
  confirmDelivery,
  refreshEligibility,
  recordSettlement,
  openDispute,
  resolveDispute,
} from '../../lib/data/adminOps';
import { getPlatformSettings } from '../../lib/data/admin';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  NoticeBanner,
  SectionHeader,
  Select,
  StatCard,
  Textarea,
} from '../../components/ui';
import { formatDate, formatMoney } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { useUi } from '../../store/ui';

/**
 * Artist payouts.
 *
 * The most carefully worded screen in the application, because it is the one
 * that could most easily lie. A row reaching `eligible` means the artist has
 * EARNED their share — delivery confirmed, return window closed, no dispute,
 * no refund. It does not mean anyone has been paid.
 *
 * Paying requires either Razorpay Route (not enabled on this account) or a
 * manual bank transfer recorded with a real reference. The database refuses
 * to mark a settlement without that evidence, so this screen cannot show a
 * payout that did not happen.
 */

const SETTLEMENT_TONE = {
  pending: 'neutral',
  eligible: 'info',
  on_hold: 'warning',
  processing: 'info',
  transferred: 'positive',
  failed: 'negative',
  reversed: 'negative',
};

const SETTLEMENT_LABEL = {
  pending: 'Not yet earned',
  eligible: 'Earned — awaiting payout',
  on_hold: 'On hold',
  processing: 'Transfer requested',
  transferred: 'Paid',
  failed: 'Transfer failed',
  reversed: 'Reversed',
};

export const AdminPayoutsPage = () => {
  useDocumentTitle('Payouts');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [status, setStatus] = useState('');
  const [paying, setPaying] = useState(null);
  const [payForm, setPayForm] = useState({ providerTransferId: '', outOfBandReference: '', note: '' });
  const [confirming, setConfirming] = useState(null);
  const [confirmForm, setConfirmForm] = useState({ evidenceRef: '', note: '' });
  const [disputing, setDisputing] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-payouts', status],
    queryFn: () => getPayoutQueue(status || undefined),
  });

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getPlatformSettings });
  const routeEnabled = settings.data?.payments?.routeEnabled === true;
  const returnWindowDays = settings.data?.returnWindowDays ?? 7;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-payouts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
  };

  const sweep = useMutation({
    mutationFn: refreshEligibility,
    onSuccess: (result) => {
      invalidate();
      success(
        result.promoted > 0
          ? `${result.promoted} ${result.promoted === 1 ? 'item is' : 'items are'} now payable`
          : 'Nothing became payable',
        result.promoted > 0 ? '' : 'Every delivered item is still inside its return window.',
      );
    },
    onError: (err) => failure('The sweep failed', err.message),
  });

  const markDelivered = useMutation({
    mutationFn: () => confirmDelivery(confirming.id, confirmForm),
    onSuccess: (result) => {
      invalidate();
      setConfirming(null);
      setConfirmForm({ evidenceRef: '', note: '' });
      success(
        'Delivery confirmed',
        `The return window closes ${formatDate(result.returnWindowEndsAt)}. The artist's share becomes payable after that.`,
      );
    },
    onError: (err) => failure('Not confirmed', err.message),
  });

  const pay = useMutation({
    mutationFn: () => recordSettlement(paying.id, payForm),
    onSuccess: (result) => {
      invalidate();
      setPaying(null);
      setPayForm({ providerTransferId: '', outOfBandReference: '', note: '' });
      success(
        'Settlement recorded',
        `${formatMoney(result.amountMinor)} · ${result.outOfBand ? 'bank transfer' : 'gateway transfer'} ${result.reference}`,
      );
    },
    onError: (err) => failure('Not recorded', err.message),
  });

  const dispute = useMutation({
    mutationFn: () =>
      disputing.disputeOpen
        ? resolveDispute(disputing.id, disputeReason)
        : openDispute(disputing.id, disputeReason),
    onSuccess: () => {
      invalidate();
      const wasOpen = disputing.disputeOpen;
      setDisputing(null);
      setDisputeReason('');
      success(wasOpen ? 'Dispute resolved' : 'Dispute opened', wasOpen ? '' : 'Payout is blocked until it is resolved.');
    },
    onError: (err) => failure('Not saved', err.message),
  });

  if (isLoading) return <LoadingBlock label="Loading the payout queue" />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  const { items, totals } = data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Settlement"
          title="Artist payouts"
          description={`An artist's share becomes payable once delivery is confirmed and the ${returnWindowDays}-day return window closes with no dispute or refund.`}
        />
        <Button variant="secondary" onClick={() => sweep.mutate()} loading={sweep.isPending}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Run the sweep
        </Button>
      </div>

      {/*
        The single most important statement on this screen. Without Route,
        money settles into the platform's own Razorpay account and paying an
        artist is a manual bank transfer. Saying otherwise would be a lie
        dressed as a status column.
      */}
      {!routeEnabled && (
        <NoticeBanner tone="warning" title="Razorpay Route is not enabled on this account">
          Customer payments settle into your own Razorpay account, so artist payouts are not automatic.
          This queue is an <strong>accounting ledger</strong>: it records what each artist has earned.
          To pay someone, make the bank transfer yourself and record it here with its reference — the
          database refuses to mark a payout without one.
        </NoticeBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Earned, awaiting payout"
          value={formatMoney(totals.eligibleMinor, totals.currency)}
          sublabel={`${totals.eligibleCount} ${totals.eligibleCount === 1 ? 'item' : 'items'} ready`}
          tone="accent"
        />
        <StatCard
          label="Not yet earned"
          value={formatMoney(totals.pendingMinor, totals.currency)}
          sublabel="undelivered, or inside the return window"
        />
        <StatCard
          label="On hold"
          value={formatMoney(totals.onHoldMinor, totals.currency)}
          sublabel="disputed or partly refunded"
        />
        <StatCard
          label="Paid out"
          value={formatMoney(totals.transferredMinor, totals.currency)}
          sublabel="confirmed with a reference"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by settlement status"
          className="w-auto min-w-[14rem]"
        >
          <option value="">Everything</option>
          <option value="eligible">Earned — awaiting payout</option>
          <option value="pending">Not yet earned</option>
          <option value="on_hold">On hold</option>
          <option value="transferred">Paid</option>
        </Select>
        <span className="text-[0.85rem] text-muted">
          {items.length} {items.length === 1 ? 'line' : 'lines'}
        </span>
      </div>

      {!items.length ? (
        <EmptyState
          icon={Banknote}
          title={status ? 'Nothing with that status' : 'No sales to settle yet'}
          message={
            status
              ? 'Try another status.'
              : 'Once a paid order is delivered and its return window closes, it appears here.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const payable = item.settlementStatus === 'eligible' && !item.isPaid;
            const needsDelivery = !item.deliveryConfirmedAt && item.fulfilmentStatus !== 'cancelled';
            const windowOpen =
              item.returnWindowEndsAt && new Date(item.returnWindowEndsAt) > new Date();

            return (
              <li key={item.id} className="panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[1.05rem] font-medium">{item.title}</h3>
                      <Badge tone={SETTLEMENT_TONE[item.settlementStatus]}>
                        {SETTLEMENT_LABEL[item.settlementStatus]}
                      </Badge>
                      {item.disputeOpen && <Badge tone="negative">Disputed</Badge>}
                      {item.refundedMinor > 0 && <Badge tone="warning">Partly refunded</Badge>}
                    </div>

                    <p className="text-[0.85rem] text-muted">
                      {item.artistSlug ? (
                        <Link to={`/artists/${item.artistSlug}`} className="text-accent-300 hover:underline">
                          {item.artistName}
                        </Link>
                      ) : (
                        item.artistName
                      )}
                      {' · order '}
                      <span className="font-mono">{item.orderNumber}</span>
                      {' · '}
                      {formatDate(item.createdAt)}
                    </p>

                    {/* The full commission breakdown, from the snapshot. */}
                    <p className="text-[0.82rem] text-muted">
                      {formatMoney(item.lineTotalMinor)} gross · {item.commissionRatePercent}% commission{' '}
                      {formatMoney(item.commissionMinor)} ·{' '}
                      <span className="font-medium text-ink">{formatMoney(item.earningsMinor)} to the artist</span>
                    </p>

                    {item.settlementHoldReason && (
                      <p className="inline-flex items-start gap-1.5 text-[0.82rem] text-amber-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {item.settlementHoldReason}
                      </p>
                    )}

                    {item.deliveryConfirmedAt && (
                      <p className="text-[0.8rem] text-muted">
                        Delivered {formatDate(item.deliveryConfirmedAt)}
                        {item.returnWindowEndsAt && (
                          <>
                            {' · return window '}
                            {windowOpen ? 'closes' : 'closed'} {formatDate(item.returnWindowEndsAt)}
                          </>
                        )}
                      </p>
                    )}

                    {item.isPaid && (
                      <p className="inline-flex items-center gap-1.5 text-[0.82rem] text-emerald-700">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Paid · {item.paidOutOfBand ? 'bank transfer' : 'gateway'}{' '}
                        <span className="font-mono">{item.paidReference}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {needsDelivery && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirming(item)}
                      >
                        <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Confirm delivery
                      </Button>
                    )}

                    {payable && (
                      <Button variant="primary" size="sm" onClick={() => setPaying(item)}>
                        <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                        Record payout
                      </Button>
                    )}

                    {!item.isPaid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDisputing(item);
                          setDisputeReason('');
                        }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {item.disputeOpen ? 'Resolve dispute' : 'Open dispute'}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Confirm delivery ── */}
      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Confirm delivery"
        description={confirming ? `"${confirming.title}" on order ${confirming.orderNumber}` : undefined}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setConfirming(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => markDelivered.mutate()}
              loading={markDelivered.isPending}
              className="flex-1"
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <NoticeBanner tone="info">
            This starts the {returnWindowDays}-day return window. The artist&apos;s share becomes payable
            when it closes, provided no dispute or refund has been raised.
          </NoticeBanner>

          <Field
            label="Evidence reference"
            htmlFor="delivery-evidence"
            hint="A carrier tracking number, a proof-of-delivery id, or whatever you can point at later."
          >
            <Input
              id="delivery-evidence"
              value={confirmForm.evidenceRef}
              onChange={(event) => setConfirmForm({ ...confirmForm, evidenceRef: event.target.value })}
              placeholder="BD-123456789"
            />
          </Field>

          <Field label="Note" htmlFor="delivery-note" hint="Optional. Recorded on the audit trail.">
            <Textarea
              id="delivery-note"
              value={confirmForm.note}
              onChange={(event) => setConfirmForm({ ...confirmForm, note: event.target.value })}
              rows={3}
            />
          </Field>
        </div>
      </Modal>

      {/* ── Record payout ── */}
      <Modal
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        title="Record a payout"
        description={paying ? `${formatMoney(paying.earningsMinor)} to ${paying.artistName}` : undefined}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setPaying(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => pay.mutate()} loading={pay.isPending} className="flex-1">
              Record it
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <NoticeBanner tone="warning" title="This records a payment, it does not make one">
            Make the transfer first, then record its reference here. The database refuses a settlement
            without evidence, precisely so this screen cannot claim an artist was paid when they were not.
          </NoticeBanner>

          {routeEnabled && paying?.hasLinkedAccount ? (
            <Field
              label="Razorpay Route transfer id"
              htmlFor="pay-transfer"
              hint="From the Route transfer you created for this artist's linked account."
            >
              <Input
                id="pay-transfer"
                value={payForm.providerTransferId}
                onChange={(event) => setPayForm({ ...payForm, providerTransferId: event.target.value })}
                placeholder="trf_..."
              />
            </Field>
          ) : (
            <>
              {routeEnabled && !paying?.hasLinkedAccount && (
                <NoticeBanner tone="info">
                  This artist has no activated linked account, so a gateway transfer is not possible.
                  Pay them by bank transfer and record the reference below.
                </NoticeBanner>
              )}
              <Field
                label="Bank transfer reference"
                htmlFor="pay-reference"
                hint="The UTR or reference from your bank. Required."
              >
                <Input
                  id="pay-reference"
                  value={payForm.outOfBandReference}
                  onChange={(event) => setPayForm({ ...payForm, outOfBandReference: event.target.value })}
                  placeholder="UTR123456789012"
                  required
                />
              </Field>
            </>
          )}

          <Field label="Note" htmlFor="pay-note" hint="Optional. Recorded on the audit trail.">
            <Textarea
              id="pay-note"
              value={payForm.note}
              onChange={(event) => setPayForm({ ...payForm, note: event.target.value })}
              rows={2}
            />
          </Field>
        </div>
      </Modal>

      {/* ── Dispute ── */}
      <Modal
        open={Boolean(disputing)}
        onClose={() => setDisputing(null)}
        title={disputing?.disputeOpen ? 'Resolve this dispute' : 'Open a dispute'}
        description={disputing?.title}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setDisputing(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant={disputing?.disputeOpen ? 'primary' : 'danger'}
              onClick={() => dispute.mutate()}
              loading={dispute.isPending}
              className="flex-1"
            >
              {disputing?.disputeOpen ? 'Resolve' : 'Open dispute'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-[0.9rem] leading-relaxed text-muted">
            {disputing?.disputeOpen
              ? 'Resolving returns the line to the normal flow. The sweep will re-check the return window and any refund before it becomes payable again.'
              : 'An open dispute blocks the payout until it is resolved, even if the return window has already closed.'}
          </p>

          <Field
            label={disputing?.disputeOpen ? 'How was it resolved?' : 'Why is it disputed?'}
            htmlFor="dispute-reason"
            required
          >
            <Textarea
              id="dispute-reason"
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              rows={4}
              placeholder={
                disputing?.disputeOpen
                  ? 'Collector confirmed the piece arrived undamaged after re-delivery.'
                  : 'Collector reports the frame arrived cracked.'
              }
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

export default AdminPayoutsPage;
