import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, Eye } from 'lucide-react';
import { Badge, Button } from '../components/ui';
import { formatDimensions, formatMoney } from '../lib/format';
import { imageSource } from '../lib/images';
import { SLOTS_PER_ROOM } from './galleryConstants';

/**
 * The non-3D walkthrough.
 *
 * Used when the visitor has asked for reduced motion, when WebGL is
 * unavailable, or when they choose the lighter view. It is a genuine
 * alternative rather than a downgrade notice: the same rooms, the same pieces,
 * the same left and right walls, and the same detail view — just laid out as a
 * page that scrolls normally.
 */
export const GalleryFallback = ({ artworks, rooms, onSelect, reason }) => {
  const byRoom = new Map();

  artworks.forEach((artwork) => {
    const room = artwork.gallery.room;
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(artwork);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6">
      {reason && (
        <div className="mb-10 rounded-2xl border border-line bg-surface-0/60 p-5">
          <p className="eyebrow mb-1.5">Gallery walkthrough</p>
          <p className="text-sm leading-relaxed text-muted">{reason}</p>
        </div>
      )}

      {[...byRoom.entries()]
        .sort(([a], [b]) => a - b)
        .map(([room, pieces]) => {
          const left = pieces.filter((piece) => piece.gallery.side === 'left');
          const right = pieces.filter((piece) => piece.gallery.side === 'right');

          return (
            <section key={room} className="mb-20" aria-labelledby={`room-${room}`}>
              <header className="mb-8 flex items-baseline justify-between gap-4 border-b border-line pb-4">
                <h2 id={`room-${room}`} className="text-display-md">
                  {rooms?.find((entry) => entry.room === room)?.label ?? `Room ${room + 1}`}
                </h2>
                <p className="font-mono text-[0.72rem] uppercase tracking-wider text-muted">
                  {pieces.length} of {SLOTS_PER_ROOM} walls hung
                </p>
              </header>

              {/* The two walls, kept visually distinct so the spatial idea
                  survives the move to two dimensions. */}
              <div className="grid gap-x-10 gap-y-12 md:grid-cols-2">
                <Wall label="Left wall" pieces={left} onSelect={onSelect} align="left" />
                <Wall label="Right wall" pieces={right} onSelect={onSelect} align="right" />
              </div>
            </section>
          );
        })}

      <div className="rounded-2xl border border-line bg-surface-0/60 p-8 text-center">
        <h2 className="text-display-md">That is the whole exhibition</h2>
        <p className="lede mx-auto mt-3 max-w-xl">
          Every piece here is for sale in the shop, with the same price and availability.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" to="/shop">
            Browse the full collection
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="secondary" to="/artists">
            Meet the artists
          </Button>
        </div>
      </div>
    </div>
  );
};

const Wall = ({ label, pieces, onSelect, align }) => (
  <div className={clsx('space-y-8', align === 'right' && 'md:mt-16')}>
    <p className="eyebrow">{label}</p>

    {pieces.length === 0 ? (
      <p className="text-sm text-muted">Nothing hung on this wall yet.</p>
    ) : (
      pieces.map((artwork) => (
        <article key={artwork.id} className="group">
          <button
            type="button"
            onClick={() => onSelect(artwork)}
            className="block w-full text-left"
            aria-label={`View ${artwork.title} in detail`}
          >
            <div
              className={clsx(
                'art-frame transition-transform duration-500 ease-gallery group-hover:-translate-y-1',
                artwork.orientation === 'landscape'
                  ? 'aspect-[4/3]'
                  : artwork.orientation === 'square'
                    ? 'aspect-square'
                    : 'aspect-[4/5]',
              )}
            >
              {artwork.image && (
                <img
                  src={imageSource(artwork.image)}
                  alt={artwork.image.alt || artwork.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              )}

              {artwork.isSoldOut && (
                <div className="absolute inset-0 grid place-items-center bg-surface-300/65">
                  <span className="rounded-full border border-ink/25 px-4 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink">
                    Sold
                  </span>
                </div>
              )}

              <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-ink/20 bg-surface-300/80 px-3 py-1 text-[0.72rem] text-ink opacity-0 transition-opacity group-hover:opacity-100">
                <Eye className="h-3 w-3" aria-hidden="true" />
                View
              </span>
            </div>
          </button>

          {/* A gallery wall label */}
          <div className="mt-3.5 flex items-start justify-between gap-4 border-l-2 border-accent-300/30 pl-3">
            <div className="min-w-0 space-y-0.5">
              <h3 className="truncate font-display text-lg leading-snug">{artwork.title}</h3>
              <p className="truncate text-[0.8rem] text-muted">{artwork.artist?.displayName}</p>
              <p className="truncate font-mono text-[0.7rem] uppercase tracking-wider text-muted/70">
                {[artwork.medium, formatDimensions(artwork.dimensions)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="shrink-0 space-y-1 text-right">
              <p className="font-mono text-[0.82rem] text-accent-300">
                {formatMoney(artwork.priceMinor, artwork.currency)}
              </p>
              {artwork.type === 'original' && !artwork.isSoldOut && <Badge tone="neutral">1 of 1</Badge>}
            </div>
          </div>

          <Link
            to={`/art/${artwork.slug}`}
            className="mt-2 inline-block text-[0.78rem] text-muted underline-offset-4 transition-colors hover:text-accent-300 hover:underline"
          >
            Open the full listing
          </Link>
        </article>
      ))
    )}
  </div>
);
