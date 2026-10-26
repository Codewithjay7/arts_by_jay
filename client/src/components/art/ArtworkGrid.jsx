import clsx from 'clsx';
import { Frame } from 'lucide-react';
import { ArtworkCard, ArtworkCardSkeleton } from './ArtworkCard';
import { EmptyState, ErrorState } from '../ui';
import { Reveal } from '../motion/Reveal';

/**
 * The storefront grid. Handles all four states explicitly — loading, error,
 * empty and populated — so a slow or failed request never leaves a blank page
 * with no explanation.
 */
export const ArtworkGrid = ({
  artworks = [],
  isLoading = false,
  isError = false,
  error,
  onRetry,
  emptyTitle = 'No artwork matches that yet',
  emptyMessage = 'Try widening your filters, or clear them to see the whole collection.',
  emptyAction,
  columns = 'default',
  skeletonCount = 8,
  animate = true,
  className,
}) => {
  const grid = clsx(
    'grid gap-x-6 gap-y-10',
    columns === 'default' && 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    columns === 'wide' && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    columns === 'tight' && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    className,
  );

  if (isLoading) {
    return (
      <div className={grid} aria-busy="true" aria-label="Loading artwork">
        {Array.from({ length: skeletonCount }, (_, index) => (
          <ArtworkCardSkeleton key={index} orientation={index % 3 === 1 ? 'landscape' : 'portrait'} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We could not load the collection"
        message={error ?? 'Something went wrong on the way to the gallery. Please try again.'}
        onRetry={onRetry}
      />
    );
  }

  if (!artworks.length) {
    return <EmptyState icon={Frame} title={emptyTitle} message={emptyMessage} action={emptyAction} />;
  }

  return (
    <div className={grid}>
      {artworks.map((artwork, index) =>
        animate ? (
          <Reveal key={artwork.id} delay={Math.min(index, 7) * 60}>
            <ArtworkCard artwork={artwork} priority={index < 4} />
          </Reveal>
        ) : (
          <ArtworkCard key={artwork.id} artwork={artwork} priority={index < 4} />
        ),
      )}
    </div>
  );
};

/**
 * A horizontally scrolling rail for the home page. Snaps on touch and remains
 * fully keyboard navigable because the cards are ordinary links.
 */
export const ArtworkRail = ({ artworks = [], isLoading = false, className }) => {
  if (isLoading) {
    return (
      <div className={clsx('flex gap-6 overflow-hidden', className)}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="w-[70vw] shrink-0 sm:w-64">
            <ArtworkCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (!artworks.length) return null;

  return (
    <div
      className={clsx(
        'no-scrollbar -mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-2',
        'sm:mx-0 sm:px-0',
        className,
      )}
    >
      {artworks.map((artwork, index) => (
        <div key={artwork.id} className="w-[68vw] shrink-0 snap-start sm:w-60 lg:w-64">
          <ArtworkCard artwork={artwork} priority={index < 3} />
        </div>
      ))}
    </div>
  );
};
