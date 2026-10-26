import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Check,
  FolderTree,
  Package,
  Palette,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  NoticeBanner,
  Pagination,
  SectionHeader,
  Select,
  StatCard,
  Textarea,
} from '../../components/ui';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  statusLabel,
  statusTone,
} from '../../lib/format';
import { imageSource } from '../../lib/images';
import { useDebouncedValue, useDocumentTitle } from '../../lib/hooks';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';

/* ──────────────────────────── Overview ──────────────────────────── */

export const AdminOverviewPage = () => {
  useDocumentTitle('Admin Overview');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/overview');
      return result;
    },
  });

  if (isLoading) return <LoadingBlock label="Loading the marketplace" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const { users, artists, artworks, orders, revenue, queues, recentOrders } = data;

  return (
    <div className="space-y-10">
      <section aria-labelledby="revenue-heading">
        <h2 id="revenue-heading" className="eyebrow mb-4">
          Trade
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Gross sales"
            value={formatMoney(revenue.grossMinor, revenue.currency)}
            sublabel={`${revenue.paidOrderCount} paid ${revenue.paidOrderCount === 1 ? 'order' : 'orders'}`}
            tone="accent"
          />
          <StatCard
            label="Platform commission"
            value={formatMoney(revenue.commissionMinor, revenue.currency)}
            sublabel={`at ${revenue.commissionPercent}%`}
          />
          <StatCard
            label="Owed to artists"
            value={formatMoney(revenue.payableMinor, revenue.currency)}
            sublabel="gross less commission"
          />
          <StatCard
            label="Last 30 days"
            value={formatMoney(revenue.last30DaysGrossMinor, revenue.currency)}
            sublabel={`${revenue.last30DaysOrderCount} orders`}
          />
        </div>
      </section>

      {/* ── Queues that need a person ── */}
      <section aria-labelledby="queues-heading">
        <h2 id="queues-heading" className="eyebrow mb-4">
          Waiting on you
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QueueCard label="Artwork in review" count={queues.pendingArtworks} to="/admin/moderation?status=pending" icon={ShieldCheck} />
          <QueueCard label="Artist applications" count={queues.pendingArtists} to="/admin/artists?status=pending" icon={Palette} />
          <QueueCard label="Reported listings" count={queues.reportedArtworks} to="/admin/moderation?reported=true" icon={ShieldCheck} />
          <QueueCard label="Open enquiries" count={queues.openEnquiries} to="/admin/orders" icon={Package} />
        </div>
      </section>

      <section aria-labelledby="counts-heading">
        <h2 id="counts-heading" className="eyebrow mb-4">
          The marketplace
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Accounts"
            value={users.total ?? 0}
            sublabel={`${users.customer ?? 0} collectors · ${users.artist ?? 0} artists · ${users.admin ?? 0} admin`}
          />
          <StatCard
            label="Artists"
            value={artists.approved ?? 0}
            sublabel={`${artists.pending ?? 0} pending · ${artists.suspended ?? 0} suspended`}
          />
          <StatCard
            label="Listings"
            value={artworks.published ?? 0}
            sublabel={`${artworks.total ?? 0} total · ${artworks.draft ?? 0} drafts`}
          />
          <StatCard
            label="Orders"
            value={orders.total ?? 0}
            sublabel={`${orders.paid ?? 0} paid · ${orders.shipped ?? 0} shipped · ${orders.delivered ?? 0} delivered`}
          />
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="recent-heading" className="eyebrow">
            Recent orders
          </h2>
          <Link to="/admin/orders" className="text-[0.8rem] text-accent-300 underline-offset-4 hover:underline">
            All orders
          </Link>
        </div>

        {!recentOrders?.length ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
            No orders yet.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {recentOrders.map((order) => (
              <li key={order.orderNumber} className="flex flex-wrap items-center gap-4 py-3.5">
                <Link
                  to={`/admin/orders?q=${order.orderNumber}`}
                  className="min-w-0 flex-1 font-mono text-[0.82rem] text-ink transition-colors hover:text-accent-300"
                >
                  {order.orderNumber}
                </Link>
                <span className="truncate text-[0.78rem] text-muted">{order.customerEmail}</span>
                {order.isSimulatedPayment && <Badge tone="warning">Simulated</Badge>}
                <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                <span className="font-mono text-[0.84rem] text-accent-300">
                  {formatMoney(order.totalMinor, order.currency)}
                </span>
                <span className="text-[0.74rem] text-muted">{formatRelative(order.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const QueueCard = ({ label, count, to, icon: Icon }) => (
  <Link
    to={to}
    className={clsx(
      'flex items-center gap-3.5 rounded-2xl border p-4 transition-colors',
      count > 0
        ? 'border-accent-300/30 bg-accent-300/[0.05] hover:border-accent-300/60'
        : 'border-line bg-surface-0/40 hover:border-line-strong',
    )}
  >
    <span
      className={clsx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full',
        count > 0 ? 'bg-accent-300/15 text-accent-300' : 'bg-surface-150 text-muted',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block font-display text-2xl leading-none">{count ?? 0}</span>
      <span className="mt-1 block font-mono text-[0.68rem] uppercase tracking-wider text-muted">{label}</span>
    </span>
  </Link>
);

/* ──────────────────────────── Users ──────────────────────────── */

export const AdminUsersPage = () => {
  useDocumentTitle('Users');

  const queryClient = useQueryClient();
  const currentUser = useAuth((state) => state.user);
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [term, setTerm] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ role: '', isActive: true, suspendedReason: '' });

  const debounced = useDebouncedValue(term.trim(), 350);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users', debounced, role, page],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/users', {
        params: { q: debounced || undefined, role: role || undefined, page, limit: 20 },
      });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  const update = useMutation({
    mutationFn: async () => {
      const { data: result } = await api.patch(`/admin/users/${editing.id}`, editForm);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      setEditing(null);
      success('Account updated');
    },
    onError: (requestError) => failure('Not updated', errorMessage(requestError)),
  });

  const openEdit = (user) => {
    setEditing(user);
    setEditForm({ role: user.role, isActive: user.isActive, suspendedReason: user.suspendedReason ?? '' });
  };

  if (isLoading) return <LoadingBlock label="Loading accounts" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader eyebrow="Accounts" title="Users" />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email…"
            aria-label="Search users"
            className="pl-10"
          />
        </div>
        <Select
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
          className="w-auto min-w-[9rem]"
        >
          <option value="">All roles</option>
          <option value="customer">Collectors</option>
          <option value="artist">Artists</option>
          <option value="admin">Administrators</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState icon={Users} title="No accounts match that" message="Try a different search or role." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-[0.84rem]">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
                    Name
                  </th>
                  <th scope="col" className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
                    Role
                  </th>
                  <th scope="col" className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th scope="col" className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
                    Joined
                  </th>
                  <th scope="col" className="py-3 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id} className="border-b border-line/60">
                    <td className="py-3.5 pr-4">
                      <p className="text-ink">{user.name}</p>
                      <p className="text-[0.76rem] text-muted">{user.email}</p>
                    </td>
                    <td className="py-3.5 pr-4">
                      <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>
                    </td>
                    <td className="py-3.5 pr-4">
                      {user.isActive ? (
                        <Badge tone="positive">Active</Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge tone="negative">Suspended</Badge>
                          {user.suspendedReason && (
                            <p className="max-w-[14rem] text-[0.72rem] text-muted">{user.suspendedReason}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 text-[0.78rem] text-muted">{formatDate(user.createdAt)}</td>
                    <td className="py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(user)}
                        disabled={user.id === currentUser?.id}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        {user.id === currentUser?.id ? 'You' : 'Manage'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Manage ${editing?.name ?? ''}`}
        description={editing?.email}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => update.mutate()} loading={update.isPending} className="flex-1">
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field
            label="Role"
            htmlFor="user-role"
            hint="Changing a role signs the account out of every device so the new role takes effect."
          >
            <Select
              id="user-role"
              value={editForm.role}
              onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
            >
              <option value="customer">Collector</option>
              <option value="artist">Artist</option>
              <option value="admin">Administrator</option>
            </Select>
          </Field>

          {editForm.role === 'artist' && editing?.role !== 'artist' && (
            <NoticeBanner tone="info">
              An artist profile is created automatically, starting as pending. You still need to approve it
              under Artists before they can publish.
            </NoticeBanner>
          )}

          <Checkbox
            checked={editForm.isActive}
            onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
            label="Account is active"
            description="Suspending an account signs it out and blocks sign-in."
          />

          {!editForm.isActive && (
            <Field label="Reason for suspension" htmlFor="user-reason" hint="Shown to the account holder.">
              <Textarea
                id="user-reason"
                value={editForm.suspendedReason}
                onChange={(event) => setEditForm({ ...editForm, suspendedReason: event.target.value })}
                rows={3}
                maxLength={500}
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────── Artist applications ──────────────────── */

export const AdminArtistsPage = () => {
  useDocumentTitle('Artists');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState(null);
  const [decision, setDecision] = useState({ decision: 'approved', note: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-artists', status, page],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/artists', {
        params: { status: status || undefined, page, limit: 20 },
      });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  const review = useMutation({
    mutationFn: async () => {
      const { data: result } = await api.post(`/admin/artists/${reviewing.id}/review`, decision);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-artists'] });
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      setReviewing(null);
      success('Decision recorded', 'The artist has been notified.');
    },
    onError: (requestError) => failure('Not saved', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading applications" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="Applications" title="Artists" />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-10 w-auto min-w-[10rem] py-0 text-[0.82rem]"
        >
          <option value="">All artists</option>
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState icon={Palette} title="No artists match that" message="Try another status." />
      ) : (
        <>
          <ul className="space-y-4">
            {data.items.map((artist) => (
              <li key={artist.id} className="panel space-y-4 p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-150">
                    {artist.avatarUrl && (
                      <img
                        src={imageSource({ url: artist.avatarUrl })}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-xl">{artist.displayName}</h3>
                      <Badge tone={statusTone(artist.status)}>{statusLabel(artist.status)}</Badge>
                      {artist.user && !artist.user.isActive && <Badge tone="negative">Account suspended</Badge>}
                    </div>
                    <p className="text-[0.78rem] text-muted">
                      {artist.user?.email}
                      {artist.location ? ` · ${artist.location}` : ''} · applied {formatDate(artist.createdAt)}
                    </p>
                    <p className="font-mono text-[0.72rem] text-muted">
                      {artist.stats?.publishedArtworks ?? 0} live ·{' '}
                      {formatMoney(artist.stats?.lifetimeEarningsMinor ?? 0)} earned
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {artist.status === 'approved' && (
                      <Button variant="ghost" size="sm" to={`/artists/${artist.slug}`}>
                        Storefront
                      </Button>
                    )}
                    <Button
                      variant={artist.status === 'pending' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        setReviewing(artist);
                        setDecision({
                          decision: artist.status === 'approved' ? 'suspended' : 'approved',
                          note: artist.reviewNote ?? '',
                        });
                      }}
                    >
                      {artist.status === 'pending' ? 'Review' : 'Change status'}
                    </Button>
                  </div>
                </div>

                {artist.bio && (
                  <p className="border-t border-line pt-4 text-[0.84rem] leading-relaxed text-muted">
                    {artist.bio}
                  </p>
                )}

                {artist.specialities?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {artist.specialities.map((speciality) => (
                      <Badge key={speciality}>{speciality}</Badge>
                    ))}
                  </div>
                )}

                {artist.reviewNote && (
                  <p className="rounded-xl bg-surface-100/60 px-3.5 py-2.5 text-[0.78rem] text-muted">
                    Curator note: {artist.reviewNote}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={`Review ${reviewing?.displayName ?? ''}`}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setReviewing(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => review.mutate()} loading={review.isPending} className="flex-1">
              Record decision
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Decision" htmlFor="artist-decision">
            <Select
              id="artist-decision"
              value={decision.decision}
              onChange={(event) => setDecision({ ...decision, decision: event.target.value })}
            >
              <option value="approved">Approve — they can publish and sell</option>
              <option value="rejected">Reject — not approved to sell</option>
              <option value="suspended">Suspend — unpublish their live work</option>
            </Select>
          </Field>

          {decision.decision !== 'approved' && (
            <NoticeBanner tone="warning">
              Every published piece by this artist will be unpublished immediately.
            </NoticeBanner>
          )}

          <Field
            label="Note to the artist"
            htmlFor="artist-note"
            hint="Sent to them as a notification. Be specific, especially when rejecting."
          >
            <Textarea
              id="artist-note"
              value={decision.note}
              onChange={(event) => setDecision({ ...decision, note: event.target.value })}
              rows={4}
              maxLength={1000}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────── Artwork moderation ──────────────────── */

export const AdminModerationPage = () => {
  useDocumentTitle('Artwork Moderation');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState(null);
  const [note, setNote] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-moderation', status, page],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/artworks', {
        params: { status: status || undefined, page, limit: 12 },
      });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  const moderate = useMutation({
    mutationFn: async ({ id, decision, moderationNote }) => {
      const { data: result } = await api.post(`/admin/artworks/${id}/moderate`, {
        decision,
        note: moderationNote ?? '',
      });
      return result;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-moderation'] });
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      setReviewing(null);
      setNote('');
      success(
        variables.decision === 'approve'
          ? 'Published'
          : variables.decision === 'reject'
            ? 'Rejected'
            : variables.decision === 'feature'
              ? 'Featured flag toggled'
              : 'Unpublished',
      );
    },
    onError: (requestError) => failure('Not saved', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading the moderation queue" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Curation"
          title="Artwork moderation"
          description="Nothing an artist submits is publicly visible until it is approved here."
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-10 w-auto min-w-[11rem] py-0 text-[0.82rem]"
        >
          <option value="pending">In review</option>
          <option value="published">Live</option>
          <option value="rejected">Rejected</option>
          <option value="unpublished">Unpublished</option>
          <option value="draft">Drafts</option>
          <option value="">Everything</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={ShieldCheck}
          title={status === 'pending' ? 'Nothing waiting for review' : 'No listings match that'}
          message={status === 'pending' ? 'The queue is clear.' : 'Try another status.'}
        />
      ) : (
        <>
          <ul className="grid gap-5 sm:grid-cols-2">
            {data.items.map((artwork) => (
              <li key={artwork.id} className="panel overflow-hidden">
                <div className="aspect-[4/3] bg-surface-150">
                  {artwork.image ? (
                    <img
                      src={imageSource(artwork.image)}
                      alt={artwork.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-[0.78rem] text-muted">No image</div>
                  )}
                </div>

                <div className="space-y-3.5 p-5">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(artwork.status)}>{statusLabel(artwork.status)}</Badge>
                      {artwork.isFeatured && <Badge tone="accent">Featured</Badge>}
                      {artwork.moderation?.reportCount > 0 && (
                        <Badge tone="negative">{artwork.moderation.reportCount} reports</Badge>
                      )}
                    </div>
                    <h3 className="font-display text-xl">{artwork.title}</h3>
                    <p className="text-[0.78rem] text-muted">
                      {artwork.artist?.displayName}
                      {artwork.category ? ` · ${artwork.category.name}` : ''} ·{' '}
                      {formatMoney(artwork.priceMinor, artwork.currency)}
                    </p>
                    <p className="text-[0.74rem] text-muted">Updated {formatRelative(artwork.updatedAt)}</p>
                  </div>

                  {artwork.description && (
                    <p className="line-clamp-3 text-[0.82rem] leading-relaxed text-muted">{artwork.description}</p>
                  )}

                  {artwork.moderation?.note && (
                    <p className="rounded-lg bg-surface-100/60 px-3 py-2 text-[0.76rem] text-muted">
                      Note: {artwork.moderation.note}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5 border-t border-line pt-3.5">
                    {artwork.status !== 'published' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => moderate.mutate({ id: artwork.id, decision: 'approve' })}
                        loading={moderate.isPending}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve
                      </Button>
                    )}

                    {artwork.status === 'published' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => moderate.mutate({ id: artwork.id, decision: 'unpublish' })}
                      >
                        Unpublish
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moderate.mutate({ id: artwork.id, decision: 'feature' })}
                    >
                      <Star className={clsx('h-3.5 w-3.5', artwork.isFeatured && 'fill-accent-300 text-accent-300')} aria-hidden="true" />
                      {artwork.isFeatured ? 'Unfeature' : 'Feature'}
                    </Button>

                    <Button variant="ghost" size="sm" onClick={() => setReviewing(artwork)}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Reject
                    </Button>

                    {artwork.status === 'published' && (
                      <Button variant="ghost" size="sm" to={`/art/${artwork.slug}`}>
                        View
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={`Reject "${reviewing?.title ?? ''}"?`}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setReviewing(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => moderate.mutate({ id: reviewing.id, decision: 'reject', moderationNote: note })}
              loading={moderate.isPending}
              className="flex-1"
            >
              Reject it
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-[0.86rem] leading-relaxed text-muted">
            The artist is notified and can edit and resubmit. Tell them what needs to change.
          </p>
          <Field label="Why is it rejected?" htmlFor="moderation-note" required>
            <Textarea
              id="moderation-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="The images are too low resolution to print from. Please re-upload at 2000px or more on the long edge."
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────────────── Orders ──────────────────────────── */

export const AdminOrdersPage = () => {
  useDocumentTitle('Orders');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [refunding, setRefunding] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });

  const debounced = useDebouncedValue(term.trim(), 350);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-orders', debounced, status, page],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/orders', {
        params: { q: debounced || undefined, status: status || undefined, page, limit: 20 },
      });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  const refund = useMutation({
    mutationFn: async () => {
      const { data: result } = await api.post(`/admin/orders/${refunding.orderNumber}/refund`, {
        amount: refundForm.amount === '' ? null : Number(refundForm.amount),
        reason: refundForm.reason,
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      setRefunding(null);
      setRefundForm({ amount: '', reason: '' });
      success(
        'Refund issued through the gateway',
        result.isSimulated ? 'Note: this was the simulated gateway, so no money moved.' : '',
      );
    },
    onError: (requestError) => failure('Refund not issued', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading orders" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader eyebrow="Trade" title="Orders" />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search by order number or email…"
            aria-label="Search orders"
            className="pl-10"
          />
        </div>
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="w-auto min-w-[11rem]"
        >
          <option value="">All statuses</option>
          {['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].map((entry) => (
            <option key={entry} value={entry}>
              {statusLabel(entry)}
            </option>
          ))}
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState icon={Package} title="No orders match that" message="Try a different search or status." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-[0.84rem]">
              <thead>
                <tr className="border-b border-line">
                  {['Order', 'Customer', 'Status', 'Total', 'Placed', ''].map((heading, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted"
                    >
                      {heading || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => (
                  <tr key={order.id} className="border-b border-line/60">
                    <td className="py-3.5 pr-4">
                      <p className="font-mono text-ink">{order.orderNumber}</p>
                      <p className="text-[0.74rem] text-muted">
                        {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                      </p>
                    </td>
                    <td className="py-3.5 pr-4 text-[0.8rem] text-muted">{order.customerEmail}</td>
                    <td className="py-3.5 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                        {order.isSimulatedPayment && <Badge tone="warning">Simulated</Badge>}
                      </div>
                    </td>
                    <td className="py-3.5 pr-4 font-mono text-accent-300">
                      {formatMoney(order.totalMinor, order.currency)}
                    </td>
                    <td className="py-3.5 pr-4 text-[0.78rem] text-muted">{formatDateTime(order.createdAt)}</td>
                    <td className="py-3.5 text-right">
                      {order.paidAt && order.status !== 'refunded' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRefunding(order);
                            setRefundForm({ amount: '', reason: '' });
                          }}
                        >
                          Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(refunding)}
        onClose={() => setRefunding(null)}
        title={`Refund ${refunding?.orderNumber ?? ''}`}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setRefunding(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="danger" onClick={() => refund.mutate()} loading={refund.isPending} className="flex-1">
              Issue refund
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <NoticeBanner tone="warning" title="This calls the payment gateway">
            A real refund is requested from the gateway. If the gateway refuses, nothing is recorded as
            refunded — we never mark money as returned unless it was.
          </NoticeBanner>

          <Field
            label="Amount (₹)"
            htmlFor="refund-amount"
            hint={`Leave blank to refund the full ${formatMoney(refunding?.totalMinor, refunding?.currency)}.`}
          >
            <Input
              id="refund-amount"
              type="number"
              min={0}
              step="0.01"
              value={refundForm.amount}
              onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })}
              placeholder="Full amount"
            />
          </Field>

          <Field label="Reason" htmlFor="refund-reason" hint="Recorded on the payment and sent to the customer.">
            <Textarea
              id="refund-reason"
              value={refundForm.reason}
              onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })}
              rows={3}
              maxLength={500}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────────────── Categories ──────────────────────────── */

export const AdminCategoriesPage = () => {
  useDocumentTitle('Categories');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', parent: '', isFeatured: false, sortOrder: 0 });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data: result } = await api.get('/categories');
      return result;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, parent: form.parent || null, sortOrder: Number(form.sortOrder) || 0 };
      if (editing?.id) {
        const { data: result } = await api.patch(`/admin/categories/${editing.id}`, payload);
        return result;
      }
      const { data: result } = await api.post('/admin/categories', payload);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setEditing(null);
      success('Category saved');
    },
    onError: (requestError) => failure('Not saved', errorMessage(requestError)),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/admin/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      success('Category deleted');
    },
    onError: (requestError) => failure('Not deleted', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading categories" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const openNew = (parentId = '') => {
    setForm({ name: '', description: '', parent: parentId, isFeatured: false, sortOrder: 0 });
    setEditing({});
  };

  const openEdit = (category) => {
    setForm({
      name: category.name,
      description: category.description ?? '',
      parent: '',
      isFeatured: Boolean(category.isFeatured),
      sortOrder: category.sortOrder ?? 0,
    });
    setEditing(category);
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Taxonomy"
          title="Categories"
          description="A category in use by any listing cannot be deleted."
        />
        <Button variant="primary" onClick={() => openNew()}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add category
        </Button>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={FolderTree}
          title="No categories yet"
          message="Artists need at least one category before they can list work."
          action={
            <Button variant="primary" onClick={() => openNew()}>
              Add the first category
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((category) => (
            <li key={category.id} className="panel p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-xl">{category.name}</h3>
                    {category.isFeatured && <Badge tone="accent">Featured</Badge>}
                    <Badge>{category.artworkCount} works</Badge>
                  </div>
                  {category.description && <p className="text-[0.82rem] text-muted">{category.description}</p>}
                  <p className="font-mono text-[0.72rem] text-muted">/shop?category={category.slug}</p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => openNew(category.id)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Sub-category
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(category)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(category.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {category.children?.length > 0 && (
                <ul className="mt-4 space-y-2 border-l border-line pl-5">
                  {category.children.map((child) => (
                    <li key={child.id} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="text-[0.88rem] text-ink">{child.name}</span>
                        <span className="ml-2 font-mono text-[0.7rem] text-muted">
                          {child.artworkCount} works
                        </span>
                      </span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(child)}>
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(child.id)}>
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : 'Add a category'}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} className="flex-1">
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Name" htmlFor="category-name" required>
            <Input
              id="category-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              maxLength={80}
              required
            />
          </Field>

          <Field label="Description" htmlFor="category-description" hint="Shown on the category page.">
            <Textarea
              id="category-description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={3}
              maxLength={1000}
            />
          </Field>

          {!editing?.id && (
            <Field label="Parent category" htmlFor="category-parent" hint="Leave blank for a top-level category.">
              <Select
                id="category-parent"
                value={form.parent}
                onChange={(event) => setForm({ ...form, parent: event.target.value })}
              >
                <option value="">None — top level</option>
                {(data?.items ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Sort order" htmlFor="category-sort" hint="Lower numbers come first.">
            <Input
              id="category-sort"
              type="number"
              min={0}
              max={999}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </Field>

          <Checkbox
            checked={form.isFeatured}
            onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })}
            label="Feature on the home page"
          />
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────────────── Reports ──────────────────────────── */

export const AdminReportsPage = () => {
  useDocumentTitle('Reports');

  const [days, setDays] = useState(30);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-reports', days],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/reports/sales', { params: { days } });
      return result;
    },
  });

  if (isLoading) return <LoadingBlock label="Building the report" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const maxDay = Math.max(1, ...data.byDay.map((row) => row.grossMinor));
  const totalGross = data.byDay.reduce((sum, row) => sum + row.grossMinor, 0);
  const totalOrders = data.byDay.reduce((sum, row) => sum + row.orders, 0);

  return (
    <div className="space-y-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="Analysis" title="Sales reports" />
        <Select
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          aria-label="Report period"
          className="h-10 w-auto min-w-[10rem] py-0 text-[0.82rem]"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </Select>
      </div>

      {/* The report must say when its numbers are not real money. */}
      {data.note && (
        <NoticeBanner tone="warning" title="These figures include simulated orders">
          {data.note}
        </NoticeBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={`Gross, last ${days} days`} value={formatMoney(totalGross, data.currency)} tone="accent" />
        <StatCard label="Orders" value={totalOrders} />
        <StatCard
          label="Average order"
          value={formatMoney(totalOrders ? Math.round(totalGross / totalOrders) : 0, data.currency)}
        />
      </div>

      {/* ── Daily bars ──
           A plain CSS bar chart: no charting dependency for a single view. */}
      <section aria-labelledby="daily-heading">
        <h2 id="daily-heading" className="eyebrow mb-4">
          By day
        </h2>

        {!data.byDay.length ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
            No paid orders in this period.
          </p>
        ) : (
          <div className="panel p-6">
            <div className="flex h-48 items-end gap-1" role="img" aria-label="Daily gross sales">
              {data.byDay.map((row) => (
                <div key={row.date} className="group relative flex-1">
                  <div
                    className="w-full rounded-t bg-accent-300/70 transition-colors group-hover:bg-accent-300"
                    style={{ height: `${Math.max(2, (row.grossMinor / maxDay) * 100)}%` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-surface-100 px-2.5 py-1.5 text-[0.72rem] group-hover:block">
                    <p className="text-ink">{formatMoney(row.grossMinor, data.currency)}</p>
                    <p className="text-muted">
                      {row.date} · {row.orders} {row.orders === 1 ? 'order' : 'orders'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between font-mono text-[0.68rem] text-muted">
              <span>{data.byDay[0]?.date}</span>
              <span>{data.byDay[data.byDay.length - 1]?.date}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── By artist ── */}
      <section aria-labelledby="artist-heading">
        <h2 id="artist-heading" className="eyebrow mb-4">
          By artist
        </h2>

        {!data.byArtist.length ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
            No sales to report.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse text-left text-[0.84rem]">
              <thead>
                <tr className="border-b border-line">
                  {['Artist', 'Pieces', 'Gross', 'Commission', 'Artist earns'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="py-3 pr-4 font-mono text-[0.68rem] uppercase tracking-wider text-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.byArtist.map((row) => (
                  <tr key={row._id} className="border-b border-line/60">
                    <td className="py-3 pr-4">
                      {row.slug ? (
                        <Link to={`/artists/${row.slug}`} className="text-ink transition-colors hover:text-accent-300">
                          {row.displayName}
                        </Link>
                      ) : (
                        <span className="text-muted">Unknown artist</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-muted">{row.units}</td>
                    <td className="py-3 pr-4 font-mono text-ink">{formatMoney(row.grossMinor, data.currency)}</td>
                    <td className="py-3 pr-4 font-mono text-muted">
                      {formatMoney(row.commissionMinor, data.currency)}
                    </td>
                    <td className="py-3 font-mono text-accent-300">{formatMoney(row.earningsMinor, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── By category ── */}
      {data.byCategory?.length > 0 && (
        <section aria-labelledby="category-heading">
          <h2 id="category-heading" className="eyebrow mb-4">
            By category
          </h2>
          <ul className="space-y-2.5">
            {data.byCategory.map((row) => {
              const max = Math.max(1, ...data.byCategory.map((entry) => entry.grossMinor));

              return (
                <li key={row._id ?? row.name} className="space-y-1.5">
                  <div className="flex justify-between text-[0.82rem]">
                    <span className="text-ink">{row.name ?? 'Uncategorised'}</span>
                    <span className="font-mono text-muted">
                      {formatMoney(row.grossMinor, data.currency)} · {row.units}{' '}
                      {row.units === 1 ? 'piece' : 'pieces'}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-150">
                    <div
                      className="h-full rounded-full bg-accent-300/70"
                      style={{ width: `${(row.grossMinor / max) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};

/* ──────────────────────────── Settings ──────────────────────────── */

export const AdminSettingsPage = () => {
  useDocumentTitle('Settings');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const { data: result } = await api.get('/admin/settings');
      return result;
    },
  });

  if (isLoading) return <LoadingBlock label="Loading settings" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="max-w-2xl space-y-9">
      <SectionHeader
        eyebrow="Configuration"
        title="Platform settings"
        description="What this server is actually configured to do."
      />

      <NoticeBanner tone="info" title="These are read-only">
        {data.note}
      </NoticeBanner>

      <section className="space-y-4" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="eyebrow">
          Payments
        </h2>

        <dl className="divide-y divide-line border-y border-line">
          <SettingRow label="Provider" value={data.payments.provider} />
          <SettingRow label="Currency" value={data.payments.currency} />
          <SettingRow label="Platform commission" value={`${data.payments.commissionPercent}%`} />
          <SettingRow
            label="Gateway is real"
            value={data.payments.isSimulated ? 'No — simulated' : 'Yes'}
            tone={data.payments.isSimulated ? 'warning' : 'positive'}
          />
        </dl>

        {data.payments.isSimulated && (
          <NoticeBanner tone="warning" title="Simulated gateway active">
            Set <span className="font-mono">PAYMENT_PROVIDER=razorpay</span> or{' '}
            <span className="font-mono">stripe</span> in the server environment, with the matching keys and
            webhook secret, to take real payments. The server refuses to start with the simulated gateway
            when <span className="font-mono">NODE_ENV=production</span>.
          </NoticeBanner>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="eyebrow">
          Storage and features
        </h2>

        <dl className="divide-y divide-line border-y border-line">
          <SettingRow label="Image storage" value={data.storage.driver} />
          <SettingRow label="Maximum upload" value={`${data.storage.maxUploadMb} MB`} />
          <SettingRow
            label="AI photo generation"
            value={data.features.aiPhotoStudio ? 'Configured' : 'Not configured — previews only'}
            tone={data.features.aiPhotoStudio ? 'positive' : 'neutral'}
          />
          <SettingRow
            label="Email delivery"
            value={data.features.emailDelivery ? 'Configured' : 'Not configured — in-app only'}
            tone={data.features.emailDelivery ? 'positive' : 'warning'}
          />
          <SettingRow
            label="Database"
            value={data.features.inMemoryDatabase ? 'In-memory (data is lost on restart)' : 'Persistent MongoDB'}
            tone={data.features.inMemoryDatabase ? 'warning' : 'positive'}
          />
          <SettingRow label="Environment" value={data.environment} />
        </dl>
      </section>

      {data.features.inMemoryDatabase && (
        <NoticeBanner tone="warning" title="This server is using an in-memory database">
          Every account, listing and order will be discarded when the server stops. Point{' '}
          <span className="font-mono">MONGODB_URI</span> at a real MongoDB and set{' '}
          <span className="font-mono">USE_MEMORY_DB=false</span> before using this for anything real.
        </NoticeBanner>
      )}
    </div>
  );
};

const SettingRow = ({ label, value, tone = 'neutral' }) => (
  <div className="flex items-center justify-between gap-4 py-3.5">
    <dt className="text-[0.86rem] text-muted">{label}</dt>
    <dd>
      {tone === 'neutral' ? (
        <span className="font-mono text-[0.84rem] text-ink">{value}</span>
      ) : (
        <Badge tone={tone}>{value}</Badge>
      )}
    </dd>
  </div>
);
