import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell,
  Check,

  MapPin,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Star,
  Trash2,
  Truck,
} from 'lucide-react';
import api, { errorDetails, errorMessage } from '../../lib/api';
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
  RatingInput,
  SectionHeader,
  Select,
  Stars,
  Textarea,
} from '../../components/ui';
import { ArtworkGrid } from '../../components/art/ArtworkGrid';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  statusLabel,
  statusTone,
} from '../../lib/format';
import { imageSource } from '../../lib/images';
import { useDocumentTitle } from '../../lib/hooks';
import { useAuth } from '../../store/auth';
import { useWishlist } from '../../store/cart';
import { useUi } from '../../store/ui';

/* ──────────────────────────── Profile ──────────────────────────── */

export const ProfilePage = () => {
  useDocumentTitle('My Profile');

  const user = useAuth((state) => state.user);
  const setUser = useAuth((state) => state.setUser);
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [form, setForm] = useState({ name: user?.name ?? '', phone: user?.phone ?? '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});

  const saveProfile = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.patch('/account/profile', payload);
      return data;
    },
    onSuccess: (data) => {
      setUser(data.user);
      setFieldErrors({});
      success('Profile updated');
    },
    onError: (error) => {
      setFieldErrors(errorDetails(error) ?? {});
      failure('Not saved', errorMessage(error));
    },
  });

  const changePassword = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/auth/change-password', payload);
      return data;
    },
    onSuccess: () => {
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setPasswordErrors({});
      success('Password changed', 'Your other sessions have been signed out.');
    },
    onError: (error) => {
      setPasswordErrors(errorDetails(error) ?? {});
      failure('Password not changed', errorMessage(error));
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file) => {
      const payload = new FormData();
      payload.append('image', file);
      const { data } = await api.post('/account/avatar', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: (data) => {
      setUser(data.user);
      success('Picture updated');
    },
    onError: (error) => failure('Upload failed', errorMessage(error)),
  });

  return (
    <div className="max-w-2xl space-y-12">
      <section aria-labelledby="details-heading">
        <SectionHeader eyebrow="Details" title="Your profile" className="mb-7" />

        <div className="mb-7 flex items-center gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-charcoal-800">
            {user?.avatarUrl ? (
              <img src={imageSource({ url: user.avatarUrl })} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center font-display text-2xl text-muted">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label
              htmlFor="avatar-upload"
              className="inline-flex h-9 cursor-pointer items-center rounded-full bg-charcoal-750 px-4 text-[0.8rem] text-parchment transition-colors hover:bg-charcoal-700"
            >
              {uploadAvatar.isPending ? 'Uploading…' : 'Change picture'}
            </label>
            <input
              id="avatar-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadAvatar.mutate(file);
              }}
            />
            <p className="text-[0.75rem] text-muted">JPEG, PNG or WebP.</p>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveProfile.mutate(form);
          }}
          className="space-y-5"
        >
          <Field label="Name" htmlFor="profile-name" error={fieldErrors.name} required>
            <Input
              id="profile-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              error={fieldErrors.name}
              autoComplete="name"
              required
            />
          </Field>

          <Field label="Email" htmlFor="profile-email" hint="Contact support to change the email on an account.">
            <Input id="profile-email" value={user?.email ?? ''} disabled readOnly />
          </Field>

          <Field label="Phone" htmlFor="profile-phone" error={fieldErrors.phone} hint="Used for delivery questions only.">
            <Input
              id="profile-phone"
              type="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              error={fieldErrors.phone}
              autoComplete="tel"
            />
          </Field>

          <Button type="submit" variant="primary" loading={saveProfile.isPending}>
            Save changes
          </Button>
        </form>
      </section>

      <section aria-labelledby="password-heading">
        <SectionHeader eyebrow="Security" title="Change your password" className="mb-7" />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            changePassword.mutate(passwordForm);
          }}
          className="space-y-5"
        >
          <Field label="Current password" htmlFor="current-password" error={passwordErrors.currentPassword} required>
            <Input
              id="current-password"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
              error={passwordErrors.currentPassword}
              autoComplete="current-password"
              required
            />
          </Field>

          <Field
            label="New password"
            htmlFor="new-password"
            hint="At least 10 characters, with a letter and a number."
            error={passwordErrors.newPassword}
            required
          >
            <Input
              id="new-password"
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
              error={passwordErrors.newPassword}
              autoComplete="new-password"
              required
            />
          </Field>

          <NoticeBanner tone="info">
            Changing your password signs out every other device and browser.
          </NoticeBanner>

          <Button type="submit" variant="primary" loading={changePassword.isPending}>
            Change password
          </Button>
        </form>
      </section>
    </div>
  );
};

/* ──────────────────────────── Orders ──────────────────────────── */

export const OrdersPage = () => {
  useDocumentTitle('My Orders');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['orders', page, status],
    queryFn: async () => {
      const { data: result } = await api.get('/orders', {
        params: { page, limit: 10, status: status || undefined },
      });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  if (isLoading) return <LoadingBlock label="Loading your orders" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="History" title="My orders" />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter orders by status"
          className="h-10 w-auto min-w-[10rem] py-0 text-[0.82rem]"
        >
          <option value="">All orders</option>
          <option value="pending_payment">Awaiting payment</option>
          <option value="paid">Paid</option>
          <option value="processing">Being prepared</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={Package}
          title={status ? 'No orders with that status' : 'You have not ordered anything yet'}
          message={
            status
              ? 'Try another status, or see all your orders.'
              : 'When you buy a piece it will appear here, with its delivery status.'
          }
          action={
            status ? (
              <Button variant="secondary" onClick={() => setStatus('')}>
                Show all orders
              </Button>
            ) : (
              <Button variant="primary" to="/shop">
                Explore artwork
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-4">
            {data.items.map((order) => (
              <li key={order.id}>
                <Link
                  to={`/account/orders/${order.orderNumber}`}
                  className="flex flex-wrap items-center gap-5 rounded-2xl border border-charcoal-700 bg-charcoal-850/50 p-5 transition-colors hover:border-accent-300/40"
                >
                  <div className="flex shrink-0 gap-1.5">
                    {order.thumbnails.slice(0, 3).map((url, index) => (
                      <div key={index} className="h-16 w-13 overflow-hidden rounded-sm bg-charcoal-800">
                        <img
                          src={imageSource({ url })}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-mono text-[0.84rem] text-parchment">{order.orderNumber}</p>
                    <p className="text-[0.78rem] text-muted">
                      {formatDate(order.createdAt)} · {order.itemCount}{' '}
                      {order.itemCount === 1 ? 'piece' : 'pieces'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                      {order.isSimulatedPayment && <Badge tone="warning">Simulated</Badge>}
                    </div>
                  </div>

                  <p className="shrink-0 font-mono text-lg text-accent-300">
                    {formatMoney(order.totalMinor, order.currency)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
};

/* ──────────────────────── Order detail ──────────────────────── */

export const OrderDetailPage = () => {
  const { orderNumber } = useParams();
  useDocumentTitle(`Order ${orderNumber}`);

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewFor, setReviewFor] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: async () => {
      const { data: result } = await api.get(`/orders/${orderNumber}`);
      return result;
    },
    retry: false,
  });

  const cancelOrder = useMutation({
    mutationFn: async () => {
      const { data: result } = await api.post(`/orders/${orderNumber}/cancel`, { reason: cancelReason });
      return result;
    },
    onSuccess: (result) => {
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ['order', orderNumber] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      success(
        'Order cancelled',
        result.refundRequired ? 'A refund will be issued by our team through the gateway.' : '',
      );
    },
    onError: (requestError) => failure('Not cancelled', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading your order" />;

  if (isError) {
    return (
      <div className="space-y-6">
        <ErrorState
          title="We could not find that order"
          message={errorMessage(error, 'That order number does not match anything in your account.')}
          onRetry={refetch}
        />
        <Button variant="secondary" to="/account/orders">
          Back to my orders
        </Button>
      </div>
    );
  }

  const { order } = data;
  const canCancel =
    ['pending_payment', 'paid', 'processing'].includes(order.status) &&
    !order.items.some((item) => ['shipped', 'delivered'].includes(item.fulfilmentStatus));

  return (
    <div className="space-y-9">
      <div className="space-y-3">
        <Link to="/account/orders" className="text-[0.8rem] text-muted transition-colors hover:text-accent-300">
          ← All orders
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Order</p>
            <h1 className="font-mono text-display-md">{order.orderNumber}</h1>
            <p className="text-[0.84rem] text-muted">Placed {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
            {order.isSimulatedPayment && <Badge tone="warning">Simulated payment</Badge>}
          </div>
        </div>
      </div>

      {order.isSimulatedPayment && (
        <NoticeBanner tone="warning" title="This order used the simulated gateway">
          No money moved. The order record is real; the payment was not.
        </NoticeBanner>
      )}

      {order.status === 'cancelled' && (
        <NoticeBanner tone="info" title="This order was cancelled">
          {order.cancelReason || 'No reason was recorded.'}
          {order.paidAt && ' It was paid for, so a refund is being handled by our team.'}
        </NoticeBanner>
      )}

      {/* ── Items with their own fulfilment state ── */}
      <section aria-labelledby="order-items-heading">
        <h2 id="order-items-heading" className="eyebrow mb-4">
          Items
        </h2>

        <ul className="divide-y divide-charcoal-700 border-y border-charcoal-700">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-wrap gap-4 py-5">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-sm bg-charcoal-800">
                {item.imageUrl && (
                  <img src={imageSource({ url: item.imageUrl })} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <Link to={`/art/${item.slug}`} className="block font-display text-lg transition-colors hover:text-accent-300">
                  {item.title}
                </Link>
                <p className="text-[0.8rem] text-muted">
                  {item.medium}
                  {item.quantity > 1 ? ` · quantity ${item.quantity}` : ''}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.fulfilmentStatus)}>{statusLabel(item.fulfilmentStatus)}</Badge>
                  {item.trackingNumber && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted">
                      <Truck className="h-3 w-3" aria-hidden="true" />
                      {item.trackingCarrier} {item.trackingNumber}
                    </span>
                  )}
                  {item.shippedAt && (
                    <span className="text-[0.72rem] text-muted">Shipped {formatDate(item.shippedAt)}</span>
                  )}
                </div>

                {item.canReview && (
                  <Button variant="outline" size="sm" onClick={() => setReviewFor(item)}>
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                    Write a review
                  </Button>
                )}
              </div>

              <p className="shrink-0 font-mono text-[0.9rem] text-parchment">
                {formatMoney(item.lineTotalMinor, order.currency)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Summary and address ── */}
      <div className="grid gap-9 sm:grid-cols-2">
        <section aria-labelledby="order-payment-heading">
          <h2 id="order-payment-heading" className="eyebrow mb-3">
            Payment
          </h2>
          <dl className="space-y-2.5 text-[0.86rem]">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-parchment">{formatMoney(order.subtotalMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Shipping ({order.shippingMethod})</dt>
              <dd className="text-parchment">
                {order.shippingTotalMinor > 0 ? formatMoney(order.shippingTotalMinor, order.currency) : 'Free'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-charcoal-700 pt-2.5">
              <dt className="text-base text-parchment">Total</dt>
              <dd className="font-mono text-xl text-accent-300">{formatMoney(order.totalMinor, order.currency)}</dd>
            </div>
            {order.paidAt && (
              <p className="pt-1 text-[0.76rem] text-muted">Payment verified {formatDateTime(order.paidAt)}</p>
            )}
          </dl>
        </section>

        <section aria-labelledby="order-address-heading">
          <h2 id="order-address-heading" className="eyebrow mb-3">
            Delivering to
          </h2>
          <address className="space-y-0.5 text-[0.86rem] not-italic leading-relaxed text-muted">
            <p className="text-parchment">{order.shippingAddress.fullName}</p>
            <p>{order.shippingAddress.line1}</p>
            {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
            </p>
            <p>{order.shippingAddress.country}</p>
            <p className="pt-1.5">{order.shippingAddress.phone}</p>
          </address>

          {order.customerNote && (
            <div className="mt-5">
              <h3 className="eyebrow mb-1.5">Your note</h3>
              <p className="text-[0.84rem] leading-relaxed text-muted">{order.customerNote}</p>
            </div>
          )}
        </section>
      </div>

      {/* ── Timeline ── */}
      {order.history?.length > 0 && (
        <section aria-labelledby="order-history-heading">
          <h2 id="order-history-heading" className="eyebrow mb-4">
            Timeline
          </h2>
          <ol className="space-y-3 border-l border-charcoal-700 pl-5">
            {[...order.history].reverse().map((entry, index) => (
              <li key={index} className="relative">
                <span
                  className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-accent-300"
                  aria-hidden="true"
                />
                <p className="text-[0.86rem] text-parchment">{statusLabel(entry.status)}</p>
                <p className="text-[0.76rem] text-muted">
                  {formatDateTime(entry.at)}
                  {entry.note ? ` · ${entry.note}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canCancel && (
        <div className="border-t border-charcoal-700 pt-6">
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            Cancel this order
          </Button>
        </div>
      )}

      {/* ── Cancel dialog ── */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setCancelOpen(false)} className="flex-1">
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => cancelOrder.mutate()}
              loading={cancelOrder.isPending}
              className="flex-1"
            >
              Cancel the order
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-[0.88rem] leading-relaxed text-muted">
            The artist will be told, and nothing will be dispatched.
            {order.paidAt &&
              ' Because this order was already paid, a refund has to be issued by our team through the payment gateway — it is not automatic.'}
          </p>
          <Field label="Why are you cancelling?" htmlFor="cancel-reason" hint="Optional, but it helps the artist.">
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              rows={3}
              maxLength={500}
            />
          </Field>
        </div>
      </Modal>

      {/* ── Review dialog ── */}
      <ReviewModal item={reviewFor} onClose={() => setReviewFor(null)} orderNumber={orderNumber} />
    </div>
  );
};

const ReviewModal = ({ item, onClose, orderNumber }) => {
  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [rating, setRating] = useState(5);
  const [form, setForm] = useState({ title: '', body: '' });

  useEffect(() => {
    if (item) {
      setRating(5);
      setForm({ title: '', body: '' });
    }
  }, [item]);

  const submit = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/reviews', {
        artworkId: item.artworkId,
        rating,
        title: form.title,
        body: form.body,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderNumber] });
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      success('Thank you for the review');
      onClose();
    },
    onError: (error) => failure('Review not saved', errorMessage(error)),
  });

  if (!item) return null;

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title={`Review "${item.title}"`}
      description="Only buyers whose order was delivered can review a piece."
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => submit.mutate()}
            loading={submit.isPending}
            className="flex-1"
          >
            Publish review
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Your rating" required>
          <RatingInput value={rating} onChange={setRating} />
        </Field>

        <Field label="Headline" htmlFor="review-title" hint="Optional.">
          <Input
            id="review-title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            maxLength={160}
            placeholder="Exactly as described"
          />
        </Field>

        <Field label="Your review" htmlFor="review-body" hint="Optional, but useful to other collectors.">
          <Textarea
            id="review-body"
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            rows={5}
            maxLength={4000}
            placeholder="How it arrived, how it looks in the room, anything you would want to know."
          />
        </Field>
      </div>
    </Modal>
  );
};

/* ──────────────────────────── Wishlist ──────────────────────────── */

export const WishlistPage = () => {
  useDocumentTitle('Wishlist');

  const { items, status, load } = useWishlist();

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'loading' || status === 'idle') return <LoadingBlock label="Loading your wishlist" />;

  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Saved"
        title="Wishlist"
        description={items.length ? `${items.length} ${items.length === 1 ? 'piece' : 'pieces'} saved.` : undefined}
      />

      <ArtworkGrid
        artworks={items}
        columns="wide"
        emptyTitle="Nothing saved yet"
        emptyMessage="Tap the heart on any piece to keep it here while you decide."
        emptyAction={
          <Button variant="primary" to="/shop">
            Explore artwork
          </Button>
        }
      />
    </div>
  );
};

/* ──────────────────────────── Addresses ──────────────────────────── */

const EMPTY_ADDRESS = {
  label: 'Home',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
  isDefault: false,
};

export const AddressesPage = () => {
  useDocumentTitle('Addresses');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_ADDRESS);
  const [fieldErrors, setFieldErrors] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: async () => {
      const { data: result } = await api.get('/account/addresses');
      return result;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing?.id) {
        const { data: result } = await api.patch(`/account/addresses/${editing.id}`, form);
        return result;
      }
      const { data: result } = await api.post('/account/addresses', form);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setEditing(null);
      setFieldErrors({});
      success('Address saved');
    },
    onError: (error) => {
      setFieldErrors(errorDetails(error) ?? {});
      failure('Not saved', errorMessage(error));
    },
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/account/addresses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
      success('Address removed');
    },
    onError: (error) => failure('Not removed', errorMessage(error)),
  });

  const openNew = () => {
    setForm(EMPTY_ADDRESS);
    setEditing({});
    setFieldErrors({});
  };

  const openEdit = (address) => {
    setForm({ ...EMPTY_ADDRESS, ...address });
    setEditing(address);
    setFieldErrors({});
  };

  if (isLoading) return <LoadingBlock label="Loading your addresses" />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="Delivery" title="Addresses" />
        <Button variant="primary" onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add an address
        </Button>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          message="Save an address and checkout fills itself in next time."
          action={
            <Button variant="primary" onClick={openNew}>
              Add an address
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.items.map((address) => (
            <li key={address.id} className="panel space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-[0.92rem] text-parchment">{address.label}</p>
                  {address.isDefault && <Badge tone="accent">Default</Badge>}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(address)}
                    className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-parchment"
                    aria-label={`Edit ${address.label}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(address.id)}
                    className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-red-300"
                    aria-label={`Remove ${address.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <address className="space-y-0.5 text-[0.82rem] not-italic leading-relaxed text-muted">
                <p className="text-parchment">{address.fullName}</p>
                <p>{address.line1}</p>
                {address.line2 && <p>{address.line2}</p>}
                <p>
                  {address.city}, {address.state} {address.postalCode}
                </p>
                <p>{address.country}</p>
                <p className="pt-1">{address.phone}</p>
              </address>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit address' : 'Add an address'}
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} className="flex-1">
              Save address
            </Button>
          </div>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Label" htmlFor="address-label" hint="Home, studio, office…" className="sm:col-span-2">
            <Input
              id="address-label"
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              maxLength={40}
            />
          </Field>

          {[
            { key: 'fullName', label: 'Recipient name', span: true, autoComplete: 'name' },
            { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
            { key: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
            { key: 'line1', label: 'Address', span: true, autoComplete: 'address-line1' },
            { key: 'line2', label: 'Address line 2', span: true, autoComplete: 'address-line2', optional: true },
            { key: 'city', label: 'City', autoComplete: 'address-level2' },
            { key: 'state', label: 'State or region', autoComplete: 'address-level1' },
            { key: 'country', label: 'Country', span: true, autoComplete: 'country-name' },
          ].map((field) => (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`address-${field.key}`}
              error={fieldErrors[field.key]}
              required={!field.optional}
              hint={field.optional ? 'Optional.' : undefined}
              className={field.span ? 'sm:col-span-2' : undefined}
            >
              <Input
                id={`address-${field.key}`}
                type={field.type ?? 'text'}
                value={form[field.key] ?? ''}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                error={fieldErrors[field.key]}
                autoComplete={field.autoComplete}
                required={!field.optional}
              />
            </Field>
          ))}

          <div className="sm:col-span-2">
            <Checkbox
              checked={form.isDefault}
              onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              label="Use this as my default delivery address"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────────── Commissions ──────────────────────── */

export const MyCommissionsPage = () => {
  useDocumentTitle('My Commissions');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-commissions'],
    queryFn: async () => {
      const { data: result } = await api.get('/account/commissions');
      return result;
    },
  });

  if (isLoading) return <LoadingBlock label="Loading your enquiries" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Conversations"
        title="Commissions and enquiries"
        description="Everything you have asked an artist about, and what they said back."
      />

      {!data?.items?.length ? (
        <EmptyState
          icon={MessageSquare}
          title="No enquiries yet"
          message="Ask an artist about a commission, or start from a photograph in the studio."
          action={
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button variant="primary" to="/studio">
                Open the studio
              </Button>
              <Button variant="secondary" to="/artists">
                Browse artists
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="space-y-5">
          {data.items.map((request) => (
            <li key={request.id} className="panel space-y-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <p className="font-mono text-[0.76rem] text-muted">{request.reference}</p>
                  <h3 className="font-display text-xl">{request.subject || 'Commission enquiry'}</h3>
                  <p className="text-[0.78rem] text-muted">
                    {request.artist ? `With ${request.artist.displayName}` : 'Awaiting an artist'} ·{' '}
                    {formatRelative(request.createdAt)}
                  </p>
                </div>
                <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
              </div>

              <p className="whitespace-pre-line text-[0.86rem] leading-relaxed text-muted">{request.message}</p>

              {request.quotedAmountMinor != null && (
                <div className="rounded-xl border border-accent-300/25 bg-accent-300/[0.05] p-4">
                  <p className="eyebrow mb-1">Quoted</p>
                  <p className="font-mono text-xl text-accent-300">{formatMoney(request.quotedAmountMinor)}</p>
                  {request.quoteNote && (
                    <p className="mt-2 text-[0.82rem] leading-relaxed text-muted">{request.quoteNote}</p>
                  )}
                </div>
              )}

              {request.messages?.length > 0 && (
                <div className="space-y-3 border-t border-charcoal-700 pt-4">
                  <p className="eyebrow">Replies</p>
                  {request.messages.map((message, index) => (
                    <div key={index} className="rounded-xl bg-charcoal-900/60 p-3.5">
                      <p className="text-[0.84rem] leading-relaxed text-parchment/90">{message.body}</p>
                      <p className="mt-1.5 text-[0.72rem] text-muted">
                        {message.fromRole === 'artist' ? 'The artist' : 'Arts by Jay'} ·{' '}
                        {formatRelative(message.at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {request.referenceImages?.length > 0 && (
                <div className="flex gap-2 border-t border-charcoal-700 pt-4">
                  {request.referenceImages.map((image) => (
                    <div key={image.url} className="h-16 w-16 overflow-hidden rounded-sm bg-charcoal-800">
                      <img
                        src={imageSource({ url: image.url })}
                        alt="Reference you supplied"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ──────────────────────────── Reviews ──────────────────────────── */

export const MyReviewsPage = () => {
  useDocumentTitle('My Reviews');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-reviews'],
    queryFn: async () => {
      const { data: result } = await api.get('/account/reviews');
      return result;
    },
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      success('Review removed');
    },
    onError: (requestError) => failure('Not removed', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading your reviews" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader eyebrow="What you said" title="My reviews" />

      {!data?.items?.length ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          message="Once a piece you bought has been delivered, you can review it from the order."
          action={
            <Button variant="secondary" to="/account/orders">
              See my orders
            </Button>
          }
        />
      ) : (
        <ul className="space-y-4">
          {data.items.map((review) => (
            <li key={review.id} className="panel flex gap-4 p-5">
              {review.artwork && (
                <Link to={`/art/${review.artwork.slug}`} className="shrink-0">
                  <div className="h-20 w-16 overflow-hidden rounded-sm bg-charcoal-800">
                    {review.artwork.image && (
                      <img
                        src={imageSource({ url: review.artwork.image })}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                </Link>
              )}

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Stars value={review.rating} />
                  {review.isHidden && <Badge tone="negative">Hidden by a moderator</Badge>}
                </div>
                {review.artwork && (
                  <Link
                    to={`/art/${review.artwork.slug}`}
                    className="block font-display text-lg transition-colors hover:text-accent-300"
                  >
                    {review.artwork.title}
                  </Link>
                )}
                {review.title && <p className="text-[0.88rem] text-parchment">{review.title}</p>}
                {review.body && <p className="text-[0.84rem] leading-relaxed text-muted">{review.body}</p>}
                <p className="text-[0.74rem] text-muted">{formatDate(review.createdAt)}</p>
              </div>

              <button
                type="button"
                onClick={() => remove.mutate(review.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-red-300"
                aria-label="Delete this review"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ──────────────────────── Notifications ──────────────────────── */

export const NotificationsPage = () => {
  useDocumentTitle('Notifications');

  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', page],
    queryFn: async () => {
      const { data: result } = await api.get('/notifications', { params: { page, limit: 20 } });
      return result;
    },
    placeholderData: (previous) => previous,
  });

  const markRead = useMutation({
    mutationFn: async (ids) => {
      const { data: result } = await api.post('/notifications/read', ids ? { ids } : {});
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['account-summary'] });
    },
  });

  if (isLoading) return <LoadingBlock label="Loading notifications" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Activity"
          title="Notifications"
          description={data?.unread ? `${data.unread} unread.` : 'Everything is read.'}
        />
        {data?.unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markRead.mutate(null)} loading={markRead.isPending}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all read
          </Button>
        )}
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={Bell}
          title="Nothing yet"
          message="Order updates, artist replies and account notices land here."
        />
      ) : (
        <>
          <ul className="space-y-2.5">
            {data.items.map((notification) => {
              const Body = (
                <div
                  className={clsx(
                    'flex items-start gap-3.5 rounded-2xl border p-4 transition-colors',
                    notification.readAt
                      ? 'border-charcoal-700 bg-charcoal-850/40'
                      : 'border-accent-300/25 bg-accent-300/[0.04]',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      notification.readAt ? 'bg-charcoal-600' : 'bg-accent-300',
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[0.9rem] text-parchment">{notification.title}</p>
                    {notification.body && (
                      <p className="text-[0.82rem] leading-relaxed text-muted">{notification.body}</p>
                    )}
                    <p className="text-[0.72rem] text-muted">{formatRelative(notification.createdAt)}</p>
                  </div>
                </div>
              );

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      to={notification.link}
                      onClick={() => !notification.readAt && markRead.mutate([notification.id])}
                      className="block"
                    >
                      {Body}
                    </Link>
                  ) : (
                    Body
                  )}
                </li>
              );
            })}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
};
