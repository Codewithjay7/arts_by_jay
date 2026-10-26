import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  MessageSquare,
  Package,
  Pencil,
  Send,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import {
  getArtistOverview,
  listMyArtworks,
  getMyArtwork,
  createMyArtwork,
  updateMyArtwork,
  setMyArtworkStatus,
  deleteMyArtwork,
  uploadArtworkImages,
  getMyArtistProfile,
  updateMyArtistProfile,
  uploadArtistImage,
  listArtistEnquiries,
  respondToEnquiry,
} from '../../lib/data/artist';
import { errorMessage, errorDetails } from '../../lib/supabase';
import { listCategories } from '../../lib/data/artworks';
import { listArtistOrders, updateArtistOrderItem } from '../../lib/data/orders';
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
  ARTWORK_TYPE_LABELS,
  formatDate,
  formatMoney,
  formatRelative,
  statusLabel,
  statusTone,
} from '../../lib/format';
import { imageSource } from '../../lib/images';
import { useDocumentTitle } from '../../lib/hooks';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';

/* ──────────────────────────── Overview ──────────────────────────── */

export const ArtistOverviewPage = () => {
  useDocumentTitle('Artist Dashboard');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-overview'],
    queryFn: getArtistOverview,
    retry: false,
  });

  if (isLoading) return <LoadingBlock label="Loading your dashboard" />;

  if (isError) {
    const noProfile = error?.response?.status === 404;

    return noProfile ? (
      <EmptyState
        icon={Frame}
        title="You do not have an artist profile yet"
        message="Create one and you can start preparing work immediately."
        action={
          <Button variant="primary" to="/become-an-artist#apply">
            Set up my storefront
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(error)} onRetry={refetch} />
    );
  }

  const { artworks, sales, actionsNeeded, recentOrders } = data;

  return (
    <div className="space-y-10">
      <section aria-labelledby="sales-heading">
        <h2 id="sales-heading" className="eyebrow mb-4">
          Your numbers
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Your earnings"
            value={formatMoney(sales.earningsMinor, sales.currency)}
            sublabel={`after the ${sales.commissionPercent}% platform fee`}
            tone="accent"
          />
          <StatCard
            label="Gross sales"
            value={formatMoney(sales.grossMinor, sales.currency)}
            sublabel={`${sales.unitsSold} ${sales.unitsSold === 1 ? 'piece' : 'pieces'} across ${sales.orderCount} ${sales.orderCount === 1 ? 'order' : 'orders'}`}
          />
          <StatCard label="Live listings" value={artworks.published ?? 0} sublabel={`${artworks.total ?? 0} in total`} />
          <StatCard
            label="Needs you"
            value={(actionsNeeded.ordersToFulfil ?? 0) + (actionsNeeded.openEnquiries ?? 0)}
            sublabel={`${actionsNeeded.ordersToFulfil ?? 0} to dispatch · ${actionsNeeded.openEnquiries ?? 0} enquiries`}
          />
        </div>
      </section>

      {/* ── What to do next ── */}
      {(actionsNeeded.ordersToFulfil > 0 || actionsNeeded.openEnquiries > 0 || (artworks.draft ?? 0) > 0) && (
        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="eyebrow mb-4">
            Next
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actionsNeeded.ordersToFulfil > 0 && (
              <ActionCard
                icon={Package}
                title={`${actionsNeeded.ordersToFulfil} ${actionsNeeded.ordersToFulfil === 1 ? 'order' : 'orders'} to dispatch`}
                to="/artist/orders"
              />
            )}
            {actionsNeeded.openEnquiries > 0 && (
              <ActionCard
                icon={MessageSquare}
                title={`${actionsNeeded.openEnquiries} ${actionsNeeded.openEnquiries === 1 ? 'enquiry' : 'enquiries'} to answer`}
                to="/artist/enquiries"
              />
            )}
            {(artworks.draft ?? 0) > 0 && (
              <ActionCard
                icon={Frame}
                title={`${artworks.draft} ${artworks.draft === 1 ? 'draft' : 'drafts'} to finish`}
                to="/artist/artworks?status=draft"
              />
            )}
          </div>
        </section>
      )}

      {/* ── Listing breakdown ── */}
      <section aria-labelledby="listings-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="listings-heading" className="eyebrow">
            Your listings
          </h2>
          <Link to="/artist/artworks" className="text-[0.8rem] text-accent-300 underline-offset-4 hover:underline">
            Manage all
          </Link>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {[
            ['published', 'Live'],
            ['pending', 'In review'],
            ['draft', 'Drafts'],
            ['unpublished', 'Unpublished'],
            ['rejected', 'Not approved'],
            ['archived', 'Archived'],
          ].map(([key, label]) => (
            <Link
              key={key}
              to={`/artist/artworks?status=${key}`}
              className="rounded-xl border border-line bg-surface-0/50 px-4 py-3 transition-colors hover:border-accent-300/40"
            >
              <p className="font-display text-2xl">{artworks[key] ?? 0}</p>
              <p className="font-mono text-[0.68rem] uppercase tracking-wider text-muted">{label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Recent orders ── */}
      <section aria-labelledby="recent-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="recent-heading" className="eyebrow">
            Recent orders
          </h2>
          <Link to="/artist/orders" className="text-[0.8rem] text-accent-300 underline-offset-4 hover:underline">
            All orders
          </Link>
        </div>

        {!recentOrders?.length ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
            No sales yet. Your first one will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {recentOrders.map((order) => (
              <li key={order.orderNumber} className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-[0.82rem] text-ink">{order.orderNumber}</p>
                  <p className="truncate text-[0.78rem] text-muted">{order.titles.join(', ')}</p>
                  <p className="text-[0.72rem] text-muted">{formatRelative(order.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {order.isSimulatedPayment && <Badge tone="warning">Simulated</Badge>}
                  <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                  <p className="font-mono text-[0.86rem] text-accent-300">
                    {formatMoney(order.myEarningsMinor)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const ActionCard = ({ icon: Icon, title, to }) => (
  <Link
    to={to}
    className="flex items-center gap-3.5 rounded-2xl border border-accent-300/25 bg-accent-300/[0.05] p-4 transition-colors hover:border-accent-300/50"
  >
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-300/15 text-accent-300">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
    <span className="flex-1 text-[0.88rem] text-ink">{title}</span>
    <ArrowRight className="h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
  </Link>
);

/* ──────────────────────── Artwork list ──────────────────────── */

export const ArtistArtworksPage = () => {
  useDocumentTitle('My Artwork');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-artworks', status, page],
    queryFn: () => listMyArtworks({ status: status || undefined, page, limit: 12 }),
    placeholderData: (previous) => previous,
  });

  const setArtworkStatus = useMutation({
    mutationFn: ({ id, action }) => setMyArtworkStatus(id, action),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['artist-artworks'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      success(result.message);
    },
    onError: (requestError) => failure('Not changed', errorMessage(requestError)),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteMyArtwork(id),
    onSuccess: (result) => {
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['artist-artworks'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      success(result.archived ? 'Archived instead of deleted' : 'Artwork deleted', result.message ?? '');
    },
    onError: (requestError) => failure('Not deleted', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading your work" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const counts = data?.statusCounts ?? {};

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="Inventory" title="My artwork" />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-10 w-auto min-w-[11rem] py-0 text-[0.82rem]"
        >
          <option value="">All statuses</option>
          {[
            ['draft', 'Drafts'],
            ['pending', 'In review'],
            ['published', 'Live'],
            ['unpublished', 'Unpublished'],
            ['rejected', 'Not approved'],
            ['archived', 'Archived'],
          ].map(([key, label]) => (
            <option key={key} value={key}>
              {label} {counts[key] ? `(${counts[key]})` : ''}
            </option>
          ))}
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={Frame}
          title={status ? `No ${statusLabel(status).toLowerCase()} listings` : 'You have not added any work yet'}
          message={
            status
              ? 'Try another status, or see everything.'
              : 'Add your first piece. You can save it as a draft and publish when it is ready.'
          }
          action={
            status ? (
              <Button variant="secondary" onClick={() => setStatus('')}>
                Show all
              </Button>
            ) : (
              <Button variant="primary" to="/artist/artworks/new">
                Add artwork
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((artwork) => (
              <li key={artwork.id} className="panel flex flex-wrap items-center gap-4 p-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-sm bg-surface-150">
                  {artwork.image ? (
                    <img
                      src={imageSource(artwork.image, { preferThumb: true })}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-muted">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate font-display text-lg">{artwork.title}</p>
                  <p className="truncate text-[0.78rem] text-muted">
                    {ARTWORK_TYPE_LABELS[artwork.type]}
                    {artwork.medium ? ` · ${artwork.medium}` : ''}
                    {artwork.category ? ` · ${artwork.category.name}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(artwork.status)}>{statusLabel(artwork.status)}</Badge>
                    {artwork.isSoldOut && <Badge tone="negative">Sold out</Badge>}
                    {artwork.isFeatured && <Badge tone="accent">Featured</Badge>}
                    {!artwork.image && <Badge tone="warning">Needs an image</Badge>}
                  </div>
                  {artwork.moderationNote && (
                    <p className="flex items-start gap-1.5 text-[0.76rem] text-amber-200">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      {artwork.moderationNote}
                    </p>
                  )}
                </div>

                <div className="shrink-0 space-y-1 text-right">
                  <p className="font-mono text-[0.9rem] text-accent-300">
                    {formatMoney(artwork.priceMinor, artwork.currency)}
                  </p>
                  <p className="font-mono text-[0.7rem] text-muted">
                    {artwork.type === 'original' ? '1 of 1' : `${artwork.stock} in stock`}
                  </p>
                </div>

                <div className="flex w-full shrink-0 flex-wrap gap-1.5 border-t border-line pt-3 sm:w-auto sm:border-0 sm:pt-0">
                  <Button variant="ghost" size="sm" to={`/artist/artworks/${artwork.id}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </Button>

                  {['draft', 'unpublished', 'rejected'].includes(artwork.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setArtworkStatus.mutate({ id: artwork.id, action: 'publish' })}
                      loading={setArtworkStatus.isPending}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      Publish
                    </Button>
                  )}

                  {artwork.status === 'published' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setArtworkStatus.mutate({ id: artwork.id, action: 'unpublish' })}
                    >
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                      Unpublish
                    </Button>
                  )}

                  {artwork.status === 'published' && (
                    <Button variant="ghost" size="sm" to={`/art/${artwork.slug}`}>
                      View
                    </Button>
                  )}

                  <Button variant="ghost" size="sm" onClick={() => setDeleting(artwork)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setDeleting(null)} className="flex-1">
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate(deleting.id)}
              loading={remove.isPending}
              className="flex-1"
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-[0.88rem] leading-relaxed text-muted">
          This cannot be undone. If the piece has already sold it will be archived instead of deleted, so
          your buyers&apos; order records stay intact.
        </p>
      </Modal>
    </div>
  );
};

/* ──────────────────────── Artwork form ──────────────────────── */

const EMPTY_FORM = {
  title: '',
  description: '',
  story: '',
  category: '',
  type: 'original',
  style: '',
  medium: '',
  year: new Date().getFullYear(),
  tags: '',
  price: '',
  compareAtPrice: '',
  stock: 1,
  orientation: 'portrait',
  isFramed: false,
  allowBackorder: false,
  inVirtualGallery: true,
  dimensions: { width: '', height: '', depth: '', unit: 'cm' },
  shipping: { shipsFrom: '', processingDays: 3, flatRate: 0, isDigitalDelivery: false },
};

export const ArtworkFormPage = () => {
  const { id } = useParams();
  const isEditing = Boolean(id);
  useDocumentTitle(isEditing ? 'Edit artwork' : 'Add artwork');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const artistProfile = useAuth((state) => state.artistProfile);
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 10 * 60 * 1000,
  });

  const existing = useQuery({
    queryKey: ['artist-artwork', id],
    queryFn: () => getMyArtwork(id),
    enabled: isEditing,
    retry: false,
  });

  // Hydrate the form from the saved record.
  useEffect(() => {
    const artwork = existing.data?.artwork;
    if (!artwork) return;

    setForm({
      title: artwork.title ?? '',
      description: artwork.description ?? '',
      story: artwork.story ?? '',
      category: artwork.category?._id ?? artwork.category ?? '',
      type: artwork.type ?? 'original',
      style: artwork.style ?? '',
      medium: artwork.medium ?? '',
      year: artwork.year ?? new Date().getFullYear(),
      tags: (artwork.tags ?? []).join(', '),
      price: artwork.price ?? '',
      compareAtPrice: artwork.compareAtPrice ?? '',
      stock: artwork.stock ?? 1,
      orientation: artwork.orientation ?? 'portrait',
      isFramed: Boolean(artwork.isFramed),
      allowBackorder: Boolean(artwork.allowBackorder),
      inVirtualGallery: artwork.inVirtualGallery !== false,
      dimensions: {
        width: artwork.dimensions?.width ?? '',
        height: artwork.dimensions?.height ?? '',
        depth: artwork.dimensions?.depth ?? '',
        unit: artwork.dimensions?.unit ?? 'cm',
      },
      shipping: {
        shipsFrom: artwork.shipping?.shipsFrom ?? '',
        processingDays: artwork.shipping?.processingDays ?? 3,
        flatRate: artwork.shipping?.flatRate ?? 0,
        isDigitalDelivery: Boolean(artwork.shipping?.isDigitalDelivery),
      },
    });

    setImages(artwork.images ?? []);
  }, [existing.data]);

  /** Images are uploaded to a staging endpoint, then referenced on save. */
  const uploadImages = async (files) => {
    if (!files?.length) return;

    if (images.length + files.length > 8) {
      failure('Too many images', 'An artwork can have at most 8 images.');
      return;
    }

    setUploading(true);
    try {
      const data = await uploadArtworkImages([...files]);

      setImages((current) => [...current, ...data.images.map((image) => ({ ...image, alt: form.title }))]);
      success(`${data.images.length} ${data.images.length === 1 ? 'image' : 'images'} uploaded`);
    } catch (error) {
      failure('Upload failed', errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const buildPayload = () => ({
    title: form.title,
    description: form.description,
    story: form.story,
    category: form.category,
    type: form.type,
    style: form.style,
    medium: form.medium,
    year: form.year ? Number(form.year) : undefined,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    price: Number(form.price) || 0,
    compareAtPrice: form.compareAtPrice === '' ? null : Number(form.compareAtPrice),
    stock: Number(form.stock) || 0,
    orientation: form.orientation,
    isFramed: form.isFramed,
    allowBackorder: form.allowBackorder,
    inVirtualGallery: form.inVirtualGallery,
    dimensions: {
      width: form.dimensions.width === '' ? null : Number(form.dimensions.width),
      height: form.dimensions.height === '' ? null : Number(form.dimensions.height),
      depth: form.dimensions.depth === '' ? null : Number(form.dimensions.depth),
      unit: form.dimensions.unit,
    },
    shipping: {
      shipsFrom: form.shipping.shipsFrom,
      processingDays: Number(form.shipping.processingDays) || 0,
      flatRate: Number(form.shipping.flatRate) || 0,
      isDigitalDelivery: form.shipping.isDigitalDelivery,
    },
    images: images.map((image) => ({
      url: image.url,
      thumbUrl: image.thumbUrl || image.url,
      publicId: image.publicId ?? '',
      width: image.width ?? 0,
      height: image.height ?? 0,
      alt: image.alt || form.title,
    })),
  });

  const save = useMutation({
    mutationFn: async ({ publish }) => {
      const payload = buildPayload();

      const data = isEditing ? await updateMyArtwork(id, payload) : await createMyArtwork(payload);

      if (publish) {
        const statusResult = await setMyArtworkStatus(data.artwork.id, 'publish');
        return { ...data, statusMessage: statusResult.message };
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['artist-artworks'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      setFieldErrors({});
      setFormError(null);
      success(data.statusMessage ?? (isEditing ? 'Changes saved' : 'Saved as a draft'));
      navigate('/artist/artworks');
    },
    onError: (error) => {
      setFieldErrors(errorDetails(error) ?? {});
      setFormError(errorMessage(error, 'That could not be saved.'));
    },
  });

  if (isEditing && existing.isLoading) return <LoadingBlock label="Loading the piece" />;

  if (isEditing && existing.isError) {
    return (
      <ErrorState
        title="That artwork could not be loaded"
        message={errorMessage(existing.error)}
        onRetry={existing.refetch}
      />
    );
  }

  const flatCategories = (categories.data?.items ?? []).flatMap((category) => [
    category,
    ...(category.children ?? []).map((child) => ({ ...child, isChild: true })),
  ]);

  const isDigital = form.type === 'digital';
  const isOriginal = form.type === 'original';
  const canPublish = artistProfile?.status === 'approved';

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ publish: false });
      }}
      className="max-w-3xl space-y-10"
      noValidate
    >
      <SectionHeader
        eyebrow={isEditing ? 'Edit' : 'New listing'}
        title={isEditing ? form.title || 'Edit artwork' : 'Add artwork'}
        description="Everything starts as a draft. Nothing goes live until you publish it."
      />

      {formError && (
        <NoticeBanner tone="warning" title="Please check the form">
          {formError}
        </NoticeBanner>
      )}

      {!canPublish && (
        <NoticeBanner tone="info" title="You can save drafts now">
          Your artist account is {artistProfile?.status ?? 'not yet approved'}, so publishing is locked
          until a curator approves it. Everything you save here is kept.
        </NoticeBanner>
      )}

      {/* ── Images ── */}
      <section className="space-y-4" aria-labelledby="images-heading">
        <h2 id="images-heading" className="eyebrow">
          Images
        </h2>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <div key={image.url} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-150">
              <img
                src={imageSource(image, { preferThumb: true })}
                alt={`Image ${index + 1}`}
                className="h-full w-full object-cover"
              />
              {index === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-accent-300 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-white">
                  Main
                </span>
              )}
              <button
                type="button"
                onClick={() => setImages((current) => current.filter((_, position) => position !== index))}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-surface-300/80 text-ink opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove image ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}

          {images.length < 8 && (
            <label
              htmlFor="artwork-images"
              className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
            >
              <Upload className="h-5 w-5" aria-hidden="true" />
              <span className="text-[0.72rem]">{uploading ? 'Uploading…' : 'Add images'}</span>
            </label>
          )}
          <input
            id="artwork-images"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            onChange={(event) => {
              uploadImages(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        <p className="text-[0.78rem] text-muted">
          The first image is the one shown everywhere else. JPEG, PNG, WebP or AVIF, up to 8 images.
        </p>
      </section>

      {/* ── The work ── */}
      <section className="space-y-5" aria-labelledby="work-heading">
        <h2 id="work-heading" className="eyebrow">
          The work
        </h2>

        <Field label="Title" htmlFor="artwork-title" error={fieldErrors.title} required>
          <Input
            id="artwork-title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            error={fieldErrors.title}
            maxLength={180}
            required
          />
        </Field>

        <Field
          label="Description"
          htmlFor="artwork-description"
          hint="What it is, how it was made, what a buyer should know. Required before publishing."
          error={fieldErrors.description}
        >
          <Textarea
            id="artwork-description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={5}
            maxLength={8000}
            error={fieldErrors.description}
          />
        </Field>

        <Field
          label="The story behind it"
          htmlFor="artwork-story"
          hint="Shown as a quotation in the virtual gallery. One or two sentences works best."
        >
          <Textarea
            id="artwork-story"
            value={form.story}
            onChange={(event) => setForm({ ...form, story: event.target.value })}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Category" htmlFor="artwork-category" error={fieldErrors.category} required>
            <Select
              id="artwork-category"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              error={fieldErrors.category}
              required
            >
              <option value="">Choose a category…</option>
              {flatCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.isChild ? `— ${category.name}` : category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Type" htmlFor="artwork-type" hint="An original is forced to a stock of one.">
            <Select
              id="artwork-type"
              value={form.type}
              onChange={(event) => {
                const type = event.target.value;
                setForm((current) => ({
                  ...current,
                  type,
                  stock: type === 'original' ? 1 : current.stock,
                  shipping: { ...current.shipping, isDigitalDelivery: type === 'digital' },
                }));
              }}
            >
              {Object.entries(ARTWORK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Medium" htmlFor="artwork-medium">
            <Input
              id="artwork-medium"
              value={form.medium}
              onChange={(event) => setForm({ ...form, medium: event.target.value })}
              placeholder="Oil on linen"
              maxLength={120}
            />
          </Field>

          <Field label="Style" htmlFor="artwork-style">
            <Input
              id="artwork-style"
              value={form.style}
              onChange={(event) => setForm({ ...form, style: event.target.value })}
              placeholder="Colour field"
              maxLength={80}
            />
          </Field>

          <Field label="Year" htmlFor="artwork-year">
            <Input
              id="artwork-year"
              type="number"
              min={1800}
              max={2200}
              value={form.year}
              onChange={(event) => setForm({ ...form, year: event.target.value })}
            />
          </Field>

          <Field label="Orientation" htmlFor="artwork-orientation" hint="Used to frame it on the gallery wall.">
            <Select
              id="artwork-orientation"
              value={form.orientation}
              onChange={(event) => setForm({ ...form, orientation: event.target.value })}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
              <option value="square">Square</option>
            </Select>
          </Field>
        </div>

        <Field label="Tags" htmlFor="artwork-tags" hint="Comma separated. These feed the search.">
          <Input
            id="artwork-tags"
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            placeholder="abstract, green, large, oil"
          />
        </Field>
      </section>

      {/* ── Price and stock ── */}
      <section className="space-y-5" aria-labelledby="price-heading">
        <h2 id="price-heading" className="eyebrow">
          Price and availability
        </h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Price (₹)" htmlFor="artwork-price" error={fieldErrors.price} required>
            <Input
              id="artwork-price"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              error={fieldErrors.price}
              required
            />
          </Field>

          <Field
            label="Was (₹)"
            htmlFor="artwork-compare"
            hint="Optional. Shown struck through beside the price."
          >
            <Input
              id="artwork-compare"
              type="number"
              min={0}
              step="0.01"
              value={form.compareAtPrice}
              onChange={(event) => setForm({ ...form, compareAtPrice: event.target.value })}
            />
          </Field>

          {!isOriginal && (
            <Field
              label="Stock"
              htmlFor="artwork-stock"
              hint={isDigital ? 'Digital files do not deplete, but set a number anyway.' : 'How many are available.'}
            >
              <Input
                id="artwork-stock"
                type="number"
                min={0}
                value={form.stock}
                onChange={(event) => setForm({ ...form, stock: event.target.value })}
              />
            </Field>
          )}
        </div>

        {isOriginal && (
          <NoticeBanner tone="info">
            This is an original, so its stock is fixed at one. When it sells it leaves the shop
            automatically.
          </NoticeBanner>
        )}

        {!isOriginal && !isDigital && (
          <Checkbox
            checked={form.allowBackorder}
            onChange={(event) => setForm({ ...form, allowBackorder: event.target.checked })}
            label="Allow orders when out of stock"
            description="Only tick this if you can make more to order."
          />
        )}
      </section>

      {/* ── Physical details ── */}
      {!isDigital && (
        <section className="space-y-5" aria-labelledby="physical-heading">
          <h2 id="physical-heading" className="eyebrow">
            Size and shipping
          </h2>

          <Field label="Dimensions" hint="Used to hang the piece at a believable scale in the gallery.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {['width', 'height', 'depth'].map((axis) => (
                <Input
                  key={axis}
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.dimensions[axis]}
                  onChange={(event) =>
                    setForm({ ...form, dimensions: { ...form.dimensions, [axis]: event.target.value } })
                  }
                  placeholder={axis.charAt(0).toUpperCase() + axis.slice(1)}
                  aria-label={axis}
                />
              ))}
              <Select
                value={form.dimensions.unit}
                onChange={(event) =>
                  setForm({ ...form, dimensions: { ...form.dimensions, unit: event.target.value } })
                }
                aria-label="Unit"
              >
                <option value="cm">cm</option>
                <option value="in">inches</option>
              </Select>
            </div>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Ships from" htmlFor="artwork-ships-from">
              <Input
                id="artwork-ships-from"
                value={form.shipping.shipsFrom}
                onChange={(event) =>
                  setForm({ ...form, shipping: { ...form.shipping, shipsFrom: event.target.value } })
                }
                placeholder="Ahmedabad, India"
              />
            </Field>

            <Field
              label="Shipping cost (₹)"
              htmlFor="artwork-shipping-cost"
              hint="Charged once per listing. Zero means free."
            >
              <Input
                id="artwork-shipping-cost"
                type="number"
                min={0}
                step="0.01"
                value={form.shipping.flatRate}
                onChange={(event) =>
                  setForm({ ...form, shipping: { ...form.shipping, flatRate: event.target.value } })
                }
              />
            </Field>

            <Field
              label="Preparation time (days)"
              htmlFor="artwork-processing"
              hint="How long before you dispatch."
            >
              <Input
                id="artwork-processing"
                type="number"
                min={0}
                max={90}
                value={form.shipping.processingDays}
                onChange={(event) =>
                  setForm({ ...form, shipping: { ...form.shipping, processingDays: event.target.value } })
                }
              />
            </Field>
          </div>

          <Checkbox
            checked={form.isFramed}
            onChange={(event) => setForm({ ...form, isFramed: event.target.checked })}
            label="This piece is framed and ready to hang"
          />
        </section>
      )}

      {/* ── Visibility ── */}
      <section className="space-y-4" aria-labelledby="visibility-heading">
        <h2 id="visibility-heading" className="eyebrow">
          Where it appears
        </h2>

        <Checkbox
          checked={form.inVirtualGallery}
          onChange={(event) => setForm({ ...form, inVirtualGallery: event.target.checked })}
          label="Hang this in the virtual gallery"
          description="Published work with at least one image appears on the gallery walls. Untick to keep it to the shop only."
        />
      </section>

      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-3 border-t border-line pt-7">
        <Button type="submit" variant="secondary" size="lg" loading={save.isPending}>
          {isEditing ? 'Save changes' : 'Save as draft'}
        </Button>

        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => save.mutate({ publish: true })}
          loading={save.isPending}
          disabled={!canPublish}
        >
          {canPublish ? 'Save and submit for review' : 'Publishing locked'}
        </Button>

        <Button type="button" variant="ghost" size="lg" to="/artist/artworks">
          Cancel
        </Button>
      </div>

      <p className="text-[0.78rem] leading-relaxed text-muted">
        Submitting sends the piece to a curator. Once approved it goes live in the shop and the gallery.
        You can unpublish it again at any time.
      </p>
    </form>
  );
};

/* ──────────────────────── Artist orders ──────────────────────── */

export const ArtistOrdersPage = () => {
  useDocumentTitle('Orders');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [page, setPage] = useState(1);
  const [shipping, setShipping] = useState(null);
  const [tracking, setTracking] = useState({ trackingCarrier: '', trackingNumber: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-orders', page],
    queryFn: () => listArtistOrders({ page, limit: 15 }),
    placeholderData: (previous) => previous,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, payload }) => updateArtistOrderItem(itemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist-orders'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      setShipping(null);
      setTracking({ trackingCarrier: '', trackingNumber: '' });
      success('Order updated');
    },
    onError: (requestError) => failure('Not updated', errorMessage(requestError)),
  });

  if (isLoading) return <LoadingBlock label="Loading your orders" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Fulfilment"
        title="Orders"
        description="Only your own pieces appear here, even when a buyer ordered from several artists at once."
      />

      {!data?.items?.length ? (
        <EmptyState
          icon={Package}
          title="No orders yet"
          message="When a collector buys one of your pieces it will appear here, ready to dispatch."
          action={
            <Button variant="primary" to="/artist/artworks">
              Review my listings
            </Button>
          }
        />
      ) : (
        <>
          <ul className="space-y-5">
            {data.items.map((order) => (
              <li key={order.id} className="panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
                  <div className="space-y-1">
                    <p className="font-mono text-[0.86rem] text-ink">{order.orderNumber}</p>
                    <p className="text-[0.78rem] text-muted">
                      {formatDate(order.createdAt)} · {order.shipTo.fullName}, {order.shipTo.city},{' '}
                      {order.shipTo.state} {order.shipTo.postalCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {order.isSimulatedPayment && <Badge tone="warning">Simulated payment</Badge>}
                    <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                    <p className="font-mono text-[0.88rem] text-accent-300">
                      {formatMoney(order.myEarningsMinor, order.currency)}
                    </p>
                  </div>
                </div>

                <ul className="space-y-4">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-4">
                      <div className="h-16 w-13 shrink-0 overflow-hidden rounded-sm bg-surface-150">
                        {item.imageUrl && (
                          <img
                            src={imageSource({ url: item.imageUrl })}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="truncate text-[0.9rem] text-ink">{item.title}</p>
                        <p className="font-mono text-[0.74rem] text-muted">
                          Qty {item.quantity} · {formatMoney(item.lineTotalMinor, order.currency)} gross ·{' '}
                          {formatMoney(item.earningsMinor, order.currency)} to you
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={statusTone(item.fulfilmentStatus)}>
                            {statusLabel(item.fulfilmentStatus)}
                          </Badge>
                          {item.trackingNumber && (
                            <span className="inline-flex items-center gap-1 font-mono text-[0.72rem] text-muted">
                              <Truck className="h-3 w-3" aria-hidden="true" />
                              {item.trackingCarrier} {item.trackingNumber}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Only the transitions the server will actually accept. */}
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {item.allowedNext.map((next) =>
                          next === 'shipped' ? (
                            <Button
                              key={next}
                              variant="outline"
                              size="sm"
                              onClick={() => setShipping({ order, item })}
                            >
                              <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                              Mark shipped
                            </Button>
                          ) : (
                            <Button
                              key={next}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                updateItem.mutate({
                                  orderId: order.id,
                                  itemId: item.id,
                                  payload: { fulfilmentStatus: next },
                                })
                              }
                              loading={updateItem.isPending}
                            >
                              Mark {statusLabel(next).toLowerCase()}
                            </Button>
                          ),
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      {/* ── Shipping dialog ── */}
      <Modal
        open={Boolean(shipping)}
        onClose={() => setShipping(null)}
        title="Mark as shipped"
        description={shipping ? `"${shipping.item.title}" on order ${shipping.order.orderNumber}` : undefined}
        size="sm"
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setShipping(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                updateItem.mutate({
                  orderId: shipping.order.id,
                  itemId: shipping.item.id,
                  payload: { fulfilmentStatus: 'shipped', ...tracking },
                })
              }
              loading={updateItem.isPending}
              className="flex-1"
            >
              Confirm shipped
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-[0.86rem] leading-relaxed text-muted">
            The collector is notified immediately, and the tracking details appear on their order.
          </p>

          <Field label="Carrier" htmlFor="tracking-carrier" hint="Optional.">
            <Input
              id="tracking-carrier"
              value={tracking.trackingCarrier}
              onChange={(event) => setTracking({ ...tracking, trackingCarrier: event.target.value })}
              placeholder="Bluedart, DTDC, India Post…"
            />
          </Field>

          <Field label="Tracking number" htmlFor="tracking-number" hint="Optional, but collectors appreciate it.">
            <Input
              id="tracking-number"
              value={tracking.trackingNumber}
              onChange={(event) => setTracking({ ...tracking, trackingNumber: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────────────── Sales ──────────────────────────── */

export const ArtistSalesPage = () => {
  useDocumentTitle('Sales');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-overview'],
    queryFn: getArtistOverview,
    retry: false,
  });

  if (isLoading) return <LoadingBlock label="Loading your sales" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const { sales, artworks } = data;

  return (
    <div className="space-y-9">
      <SectionHeader
        eyebrow="Earnings"
        title="Sales"
        description={`Everything below is after the ${sales.commissionPercent}% platform fee is deducted, and before any payment-gateway charges.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Your earnings"
          value={formatMoney(sales.earningsMinor, sales.currency)}
          sublabel="lifetime, net of the platform fee"
          tone="accent"
        />
        <StatCard label="Gross sales" value={formatMoney(sales.grossMinor, sales.currency)} sublabel="what collectors paid" />
        <StatCard
          label="Platform fee"
          value={formatMoney(sales.commissionMinor, sales.currency)}
          sublabel={`${sales.commissionPercent}% of gross`}
        />
        <StatCard label="Pieces sold" value={sales.unitsSold} sublabel={`across ${sales.orderCount} orders`} />
      </div>

      <section className="panel space-y-4 p-6" aria-labelledby="payout-heading">
        <h2 id="payout-heading" className="eyebrow">
          How you get paid
        </h2>
        <p className="text-[0.88rem] leading-relaxed text-muted">
          Earnings accrue against your account as orders are paid for. Payouts are arranged by the
          marketplace administrators through the payment gateway; there is no automated payout schedule
          configured on this installation. Your balance above is the authoritative record of what you are
          owed.
        </p>
      </section>

      <section aria-labelledby="catalogue-heading">
        <h2 id="catalogue-heading" className="eyebrow mb-4">
          Your catalogue
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Live" value={artworks.published ?? 0} />
          <StatCard label="In review" value={artworks.pending ?? 0} />
          <StatCard label="Drafts" value={artworks.draft ?? 0} />
        </div>
      </section>
    </div>
  );
};

/* ──────────────────────── Enquiries ──────────────────────── */

const COMMISSION_STATUSES = [
  'new',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'in_progress',
  'completed',
  'cancelled',
];

export const ArtistEnquiriesPage = () => {
  useDocumentTitle('Enquiries');

  const queryClient = useQueryClient();
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [replying, setReplying] = useState(null);
  const [replyForm, setReplyForm] = useState({ reply: '', quotedAmount: '', quoteNote: '', status: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-enquiries', page, status],
    queryFn: () => listArtistEnquiries({ page, limit: 15, status: status || undefined }),
    placeholderData: (previous) => previous,
  });

  const respond = useMutation({
    mutationFn: async () => {
      const payload = {
        reply: replyForm.reply || undefined,
        quoteNote: replyForm.quoteNote || undefined,
        status: replyForm.status || undefined,
        quotedAmount: replyForm.quotedAmount === '' ? undefined : Number(replyForm.quotedAmount),
      };
      return respondToEnquiry(replying.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist-enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      setReplying(null);
      success('Reply sent');
    },
    onError: (requestError) => failure('Not sent', errorMessage(requestError)),
  });

  const openReply = (request) => {
    setReplying(request);
    setReplyForm({
      reply: '',
      quotedAmount: request.quotedAmountMinor != null ? request.quotedAmountMinor / 100 : '',
      quoteNote: request.quoteNote ?? '',
      status: request.status,
    });
  };

  if (isLoading) return <LoadingBlock label="Loading your enquiries" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader eyebrow="Conversations" title="Enquiries" />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-10 w-auto min-w-[10rem] py-0 text-[0.82rem]"
        >
          <option value="">All enquiries</option>
          {COMMISSION_STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {statusLabel(entry)}
            </option>
          ))}
        </Select>
      </div>

      {!data?.items?.length ? (
        <EmptyState
          icon={MessageSquare}
          title={status ? 'Nothing with that status' : 'No enquiries yet'}
          message={
            status
              ? 'Try another status.'
              : 'Commission requests and questions about your work will land here. Make sure commissions are switched on in your storefront settings.'
          }
          action={
            status ? (
              <Button variant="secondary" onClick={() => setStatus('')}>
                Show all
              </Button>
            ) : (
              <Button variant="secondary" to="/artist/storefront">
                Storefront settings
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-5">
            {data.items.map((request) => (
              <li key={request.id} className="panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <p className="font-mono text-[0.74rem] text-muted">{request.reference}</p>
                    <h3 className="font-display text-xl">{request.subject || 'Enquiry'}</h3>
                    <p className="text-[0.78rem] text-muted">
                      {request.contactName} · {request.contactEmail}
                      {request.contactPhone ? ` · ${request.contactPhone}` : ''}
                    </p>
                    <p className="text-[0.74rem] text-muted">{formatRelative(request.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {request.kind === 'photo_to_art' && <Badge tone="info">From the studio</Badge>}
                    <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
                  </div>
                </div>

                <p className="whitespace-pre-line text-[0.88rem] leading-relaxed text-ink/90">
                  {request.message}
                </p>

                <dl className="flex flex-wrap gap-x-7 gap-y-2 text-[0.78rem]">
                  {request.styleKey && (
                    <div>
                      <dt className="eyebrow">Treatment</dt>
                      <dd className="mt-0.5 text-ink">{request.styleKey.replace('_', ' ')}</dd>
                    </div>
                  )}
                  {request.preferredSize && (
                    <div>
                      <dt className="eyebrow">Size wanted</dt>
                      <dd className="mt-0.5 text-ink">{request.preferredSize}</dd>
                    </div>
                  )}
                  {request.budgetMinor != null && (
                    <div>
                      <dt className="eyebrow">Their budget</dt>
                      <dd className="mt-0.5 text-ink">{formatMoney(request.budgetMinor)}</dd>
                    </div>
                  )}
                  {request.quotedAmountMinor != null && (
                    <div>
                      <dt className="eyebrow">You quoted</dt>
                      <dd className="mt-0.5 text-accent-300">{formatMoney(request.quotedAmountMinor)}</dd>
                    </div>
                  )}
                </dl>

                {/* The customer's own reference photo, if they consented. */}
                {request.referenceImages?.length > 0 && (
                  <div className="space-y-2">
                    <p className="eyebrow">Reference photos they sent</p>
                    <div className="flex gap-2">
                      {request.referenceImages.map((image) => (
                        <a
                          key={image.url}
                          href={imageSource({ url: image.url })}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="h-20 w-20 overflow-hidden rounded-lg bg-surface-150"
                        >
                          <img
                            src={imageSource({ url: image.url })}
                            alt="Reference supplied by the customer"
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {request.messages?.length > 0 && (
                  <div className="space-y-2.5 border-t border-line pt-4">
                    <p className="eyebrow">Your replies</p>
                    {request.messages.map((message, index) => (
                      <div key={index} className="rounded-xl bg-surface-100/60 p-3.5">
                        <p className="text-[0.84rem] leading-relaxed text-ink/90">{message.body}</p>
                        <p className="mt-1.5 text-[0.72rem] text-muted">{formatRelative(message.at)}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button variant="primary" size="sm" onClick={() => openReply(request)}>
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Reply or quote
                  </Button>
                  <Button variant="ghost" size="sm" href={`mailto:${request.contactEmail}`}>
                    Email directly
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <Modal
        open={Boolean(replying)}
        onClose={() => setReplying(null)}
        title="Reply to this enquiry"
        description={replying?.reference}
        footer={
          <div className="flex gap-2.5">
            <Button variant="ghost" onClick={() => setReplying(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => respond.mutate()} loading={respond.isPending} className="flex-1">
              Send reply
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Your reply" htmlFor="enquiry-reply" hint="The customer sees this on their enquiry.">
            <Textarea
              id="enquiry-reply"
              value={replyForm.reply}
              onChange={(event) => setReplyForm({ ...replyForm, reply: event.target.value })}
              rows={5}
              maxLength={5000}
              placeholder="Happy to take this on. At 90 by 120cm in oil, that would be eight weeks and…"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Quote (₹)" htmlFor="enquiry-quote" hint="Optional.">
              <Input
                id="enquiry-quote"
                type="number"
                min={0}
                step="0.01"
                value={replyForm.quotedAmount}
                onChange={(event) => setReplyForm({ ...replyForm, quotedAmount: event.target.value })}
              />
            </Field>

            <Field label="Set status" htmlFor="enquiry-status">
              <Select
                id="enquiry-status"
                value={replyForm.status}
                onChange={(event) => setReplyForm({ ...replyForm, status: event.target.value })}
              >
                {COMMISSION_STATUSES.map((entry) => (
                  <option key={entry} value={entry}>
                    {statusLabel(entry)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Quote notes" htmlFor="enquiry-quote-note" hint="What the quote covers, and the timeline.">
            <Textarea
              id="enquiry-quote-note"
              value={replyForm.quoteNote}
              onChange={(event) => setReplyForm({ ...replyForm, quoteNote: event.target.value })}
              rows={3}
              maxLength={2000}
            />
          </Field>

          <NoticeBanner tone="info">
            The customer sees this in their account. Whether they also receive an email depends on the
            server&apos;s mail configuration.
          </NoticeBanner>
        </div>
      </Modal>
    </div>
  );
};

/* ──────────────────── Storefront settings ──────────────────── */

export const ArtistStorefrontPage = () => {
  useDocumentTitle('Storefront Settings');

  const queryClient = useQueryClient();
  const setArtistProfile = useAuth((state) => state.setArtistProfile);
  const refreshUser = useAuth((state) => state.refreshUser);
  const success = useUi((state) => state.success);
  const failure = useUi((state) => state.failure);

  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [uploadingField, setUploadingField] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist-profile'],
    queryFn: getMyArtistProfile,
    retry: false,
  });

  useEffect(() => {
    const profile = data?.profile;
    if (!profile || form) return;

    setForm({
      displayName: profile.displayName ?? '',
      bio: profile.bio ?? '',
      statement: profile.statement ?? '',
      location: profile.location ?? '',
      specialities: (profile.specialities ?? []).join(', '),
      acceptsCommissions: profile.acceptsCommissions !== false,
      commissionNote: profile.commissionNote ?? '',
      links: {
        website: profile.links?.website ?? '',
        instagram: profile.links?.instagram ?? '',
        behance: profile.links?.behance ?? '',
      },
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        specialities: form.specialities
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
      return updateMyArtistProfile(payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['artist-profile'] });
      queryClient.invalidateQueries({ queryKey: ['artist-overview'] });
      setArtistProfile(result.profile);
      setFieldErrors({});
      success('Storefront updated');
    },
    onError: (requestError) => {
      setFieldErrors(errorDetails(requestError) ?? {});
      failure('Not saved', errorMessage(requestError));
    },
  });

  const uploadImage = async (field, file) => {
    setUploadingField(field);
    try {
      await uploadArtistImage(field, file);
      await queryClient.invalidateQueries({ queryKey: ['artist-profile'] });
      await refreshUser();
      success(field === 'cover' ? 'Cover image updated' : 'Portrait updated');
    } catch (requestError) {
      failure('Upload failed', errorMessage(requestError));
    } finally {
      setUploadingField(null);
    }
  };

  if (isLoading || !form) {
    if (isError && error?.response?.status === 404) {
      return (
        <EmptyState
          icon={Frame}
          title="You do not have an artist profile yet"
          message="Create one and you can start preparing work straight away."
          action={
            <Button variant="primary" to="/become-an-artist#apply">
              Set up my storefront
            </Button>
          }
        />
      );
    }
    if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
    return <LoadingBlock label="Loading your storefront" />;
  }

  const profile = data.profile;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="max-w-2xl space-y-10"
      noValidate
    >
      <SectionHeader
        eyebrow="Your public page"
        title="Storefront settings"
        description="This is what collectors see on your storefront and beside every piece you sell."
      />

      {/* ── Images ── */}
      <section className="space-y-5" aria-labelledby="images-heading">
        <h2 id="images-heading" className="eyebrow">
          Portrait and cover
        </h2>

        <div className="flex items-end gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-surface-150">
            {profile.avatarUrl ? (
              <img src={imageSource({ url: profile.avatarUrl })} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center font-display text-2xl text-muted">
                {profile.displayName?.charAt(0)}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label
              htmlFor="avatar-field"
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-surface-200 px-4 text-[0.8rem] text-ink transition-colors hover:bg-line"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {uploadingField === 'avatar' ? 'Uploading…' : 'Change portrait'}
            </label>
            <input
              id="avatar-field"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadImage('avatar', file);
              }}
            />
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="h-28 overflow-hidden rounded-xl bg-surface-150">
            {profile.coverUrl ? (
              <img src={imageSource({ url: profile.coverUrl })} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-[0.78rem] text-muted">No cover image</div>
            )}
          </div>
          <label
            htmlFor="cover-field"
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-surface-200 px-4 text-[0.8rem] text-ink transition-colors hover:bg-line"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {uploadingField === 'cover' ? 'Uploading…' : 'Change cover'}
          </label>
          <input
            id="cover-field"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadImage('cover', file);
            }}
          />
        </div>
      </section>

      {/* ── Identity ── */}
      <section className="space-y-5" aria-labelledby="identity-heading">
        <h2 id="identity-heading" className="eyebrow">
          Who you are
        </h2>

        <Field
          label="Artist name"
          htmlFor="storefront-name"
          hint={profile.slug ? `Your storefront is at /artists/${profile.slug}` : undefined}
          error={fieldErrors.displayName}
          required
        >
          <Input
            id="storefront-name"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            error={fieldErrors.displayName}
            maxLength={120}
            required
          />
        </Field>

        <Field label="Where you work" htmlFor="storefront-location">
          <Input
            id="storefront-location"
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
            placeholder="Ahmedabad, India"
            maxLength={120}
          />
        </Field>

        <Field
          label="Artist statement"
          htmlFor="storefront-statement"
          hint="One line, shown as a quotation at the top of your storefront."
        >
          <Textarea
            id="storefront-statement"
            value={form.statement}
            onChange={(event) => setForm({ ...form, statement: event.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="I am after the moment a colour stops being a colour and becomes a temperature."
          />
        </Field>

        <Field label="Biography" htmlFor="storefront-bio" error={fieldErrors.bio}>
          <Textarea
            id="storefront-bio"
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
            rows={7}
            maxLength={4000}
            error={fieldErrors.bio}
          />
        </Field>

        <Field label="What you work in" htmlFor="storefront-specialities" hint="Comma separated.">
          <Input
            id="storefront-specialities"
            value={form.specialities}
            onChange={(event) => setForm({ ...form, specialities: event.target.value })}
            placeholder="Colour field, Oil on linen, Large format"
          />
        </Field>
      </section>

      {/* ── Commissions ── */}
      <section className="space-y-5" aria-labelledby="commissions-heading">
        <h2 id="commissions-heading" className="eyebrow">
          Commissions
        </h2>

        <Checkbox
          checked={form.acceptsCommissions}
          onChange={(event) => setForm({ ...form, acceptsCommissions: event.target.checked })}
          label="I take commissions"
          description="Turning this off hides the commission buttons on your storefront and your pieces."
        />

        {form.acceptsCommissions && (
          <Field
            label="What you want people to know"
            htmlFor="storefront-commission-note"
            hint="Minimum sizes, typical turnaround, what you will and will not take on."
          >
            <Textarea
              id="storefront-commission-note"
              value={form.commissionNote}
              onChange={(event) => setForm({ ...form, commissionNote: event.target.value })}
              rows={3}
              maxLength={1000}
            />
          </Field>
        )}
      </section>

      {/* ── Links ── */}
      <section className="space-y-5" aria-labelledby="links-heading">
        <h2 id="links-heading" className="eyebrow">
          Elsewhere
        </h2>

        <Field label="Website" htmlFor="storefront-website" error={fieldErrors['links.website']}>
          <Input
            id="storefront-website"
            type="url"
            value={form.links.website}
            onChange={(event) => setForm({ ...form, links: { ...form.links, website: event.target.value } })}
            error={fieldErrors['links.website']}
            placeholder="https://your-site.com"
          />
        </Field>

        <Field label="Instagram" htmlFor="storefront-instagram">
          <Input
            id="storefront-instagram"
            value={form.links.instagram}
            onChange={(event) => setForm({ ...form, links: { ...form.links, instagram: event.target.value } })}
            placeholder="@yourhandle"
          />
        </Field>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-line pt-7">
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          Save storefront
        </Button>
        {profile.status === 'approved' && profile.slug && (
          <Button variant="ghost" size="lg" to={`/artists/${profile.slug}`}>
            View my public storefront
          </Button>
        )}
      </div>
    </form>
  );
};
