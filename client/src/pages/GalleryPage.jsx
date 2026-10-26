import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, Frame, Maximize2, MousePointer2, PanelsTopLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, ErrorState, LoadingBlock } from '../components/ui';
import { useDeviceTier, useDocumentTitle, useReducedMotion } from '../lib/hooks';
import { GalleryFallback } from '../gallery/GalleryFallback';
import { SceneBoundary } from '../gallery/SceneBoundary';
import { ArtworkFocusPanel } from '../gallery/ArtworkFocusPanel';
import { PX_PER_METRE, ROOM_LENGTH, corridorLengthFor, roomIndexForZ } from '../gallery/galleryConstants';

// Three.js is ~600KB; it must not be in the bundle every other page loads.
const Canvas = lazy(() =>
  import('@react-three/fiber').then((module) => ({ default: module.Canvas })),
);
const CorridorScene = lazy(() =>
  import('../gallery/CorridorScene').then((module) => ({ default: module.CorridorScene })),
);

const webglAvailable = () => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
};

export const GalleryPage = () => {
  useDocumentTitle('The Virtual Gallery');

  const reducedMotion = useReducedMotion();
  const deviceTier = useDeviceTier();

  const [viewMode, setViewMode] = useState(null); // '3d' | 'flat'
  const [focusedId, setFocusedId] = useState(null);
  const [hasEntered, setHasEntered] = useState(false);
  // Set when the 3D scene threw, so the flat view can say why it is showing
  // instead of silently appearing to be what the visitor asked for.
  const [sceneFailed, setSceneFailed] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['gallery'],
    // The corridor layout is computed in SQL so the 3D client, the 2D
    // fallback and any future client agree on where each piece hangs.
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gallery_layout', { p_limit: 24 });
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

  // Memoised so the identity is stable: the camera's layout maths and the
  // focus lookup both depend on it and must not recompute every render.
  const artworks = useMemo(() => data?.artworks ?? [], [data]);
  const rooms = data?.rooms ?? [];

  const length = useMemo(() => corridorLengthFor(artworks), [artworks]);
  const roomCount = data?.layout?.totalRooms ?? 1;

  /* ── Scroll → camera depth ──
     The progress value lives in a ref, not state, so scrolling never triggers
     a React render. The 3D camera reads the ref inside its own frame loop. */
  const scrollRef = useRef(0);
  const scrollerRef = useRef(null);
  const [progressDisplay, setProgressDisplay] = useState(0);
  const [currentRoom, setCurrentRoom] = useState(0);

  // Decide the default view once we know the device and preference.
  useEffect(() => {
    if (viewMode) return;
    if (reducedMotion || !webglAvailable()) setViewMode('flat');
    else setViewMode('3d');
  }, [reducedMotion, viewMode]);

  /**
   * Called when the scene throws. Drops to the flat walkthrough, which shows
   * the same rooms and pieces, rather than leaving the visitor on a loading
   * state that will never finish.
   */
  const onSceneFail = useCallback(() => {
    setSceneFailed(true);
    setViewMode('flat');
  }, []);

  const is3D = viewMode === '3d';

  useEffect(() => {
    if (!is3D) return undefined;

    let frame = 0;

    const onScroll = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const total = scroller.scrollHeight - window.innerHeight;
      const progress = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
      scrollRef.current = progress;

      // The HUD only needs a few updates a second, not one per scroll event.
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setProgressDisplay(progress);
          setCurrentRoom(roomIndexForZ(progress * length));
        });
      }
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [is3D, length]);

  /* ── Focus ──
     Page scroll is locked while a piece is focused, but scrollY is never
     changed. Releasing the lock therefore puts the visitor back at the exact
     point in the corridor they stopped at. */
  useEffect(() => {
    if (!focusedId || !is3D) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [focusedId, is3D]);

  const focusedArtwork = useMemo(
    () => artworks.find((artwork) => artwork.id === focusedId) ?? null,
    [artworks, focusedId],
  );

  const onSelect = useCallback((artwork) => setFocusedId(artwork.id), []);
  const onClose = useCallback(() => setFocusedId(null), []);

  const jumpToRoom = (room) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const total = scroller.scrollHeight - window.innerHeight;
    const targetZ = room * ROOM_LENGTH + 2;
    window.scrollTo({ top: (targetZ / length) * total, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  /* ── States ── */

  if (isLoading) return <LoadingBlock label="Hanging the exhibition" className="min-h-[70vh]" />;

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24">
        <ErrorState title="The gallery could not be opened" message={error?.message} onRetry={refetch} />
      </div>
    );
  }

  if (!artworks.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24">
        <EmptyState
          icon={Frame}
          title="The walls are empty for now"
          message="No published artwork has been added to the virtual gallery yet. Browse the shop, or check back soon."
          action={
            <Button variant="primary" to="/shop">
              Explore the collection
            </Button>
          }
        />
      </div>
    );
  }

  /* ── Flat walkthrough ── */

  if (!is3D) {
    return (
      <>
        <GalleryHeader
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          canUse3D={!reducedMotion && webglAvailable()}
          total={artworks.length}
          roomCount={roomCount}
        />
        <GalleryFallback
          artworks={artworks}
          rooms={rooms}
          onSelect={onSelect}
          reason={
            sceneFailed
              ? 'The 3D view could not start on this device, so the gallery is laid out as a page instead. Nothing is missing — every room and piece is here.'
              : reducedMotion
                ? 'You have asked your device to reduce motion, so the gallery is laid out as a page you can scroll normally. Every room, wall and piece is here.'
                : !webglAvailable()
                  ? 'This browser cannot run the 3D view, so the gallery is laid out as a page instead. Nothing is missing — every room and piece is here.'
                  : 'The lighter walkthrough. Every room and piece is here, laid out as a page.'
          }
        />
        {focusedId && (
          <div className="fixed inset-0 z-40">
            <button
              type="button"
              className="absolute inset-0 bg-surface-300/85 backdrop-blur-sm"
              onClick={onClose}
              aria-label="Close artwork details"
              tabIndex={-1}
            />
            <ArtworkFocusPanel artworkId={focusedId} onClose={onClose} onSelectAlternative={onSelect} />
          </div>
        )}
      </>
    );
  }

  /* ── Immersive 3D corridor ── */

  const scrollHeight = Math.max(length * PX_PER_METRE, window.innerHeight * 2);

  return (
    <div className="relative">
      {/* The tall element that generates the scroll the camera walks along.
          The canvas itself is sticky and only one viewport tall. */}
      <div ref={scrollerRef} className="no-anchor relative" style={{ height: `${scrollHeight}px` }}>
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          <SceneBoundary onFail={onSceneFail} resetKey={viewMode}>
            <Suspense fallback={<LoadingBlock label="Building the gallery" className="h-screen" />}>
              <Canvas
                // Clamping DPR is the single biggest win on a laptop or phone.
                dpr={deviceTier === 'low' ? [1, 1.25] : [1, 1.75]}
                shadows={deviceTier === 'high'}
                gl={{ antialias: deviceTier !== 'low', powerPreference: 'high-performance' }}
                camera={{ fov: 55, near: 0.1, far: 120, position: [0, 1.68, 0] }}
                className="h-full w-full"
              >
                <CorridorScene
                  artworks={artworks}
                  scrollRef={scrollRef}
                  focusedArtwork={focusedArtwork}
                  onSelect={onSelect}
                  length={length}
                  roomCount={roomCount}
                  quality={deviceTier}
                  reducedMotion={reducedMotion}
                />
              </Canvas>
            </Suspense>
          </SceneBoundary>

          {/* ── Entry overlay ── */}
          {!hasEntered && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-gradient-to-b from-surface-300/90 via-surface-300/70 to-surface-300/95 px-6 backdrop-blur-sm">
              <div className="max-w-xl space-y-6 text-center">
                <p className="eyebrow">Arts by Jay · Exhibition</p>
                <h1 className="text-display-lg">Walk the gallery</h1>
                <p className="lede">
                  {artworks.length} works across {roomCount} {roomCount === 1 ? 'room' : 'rooms'}. Scroll
                  to walk forward. Select any piece to step up to it, read its story and buy it.
                </p>

                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.78rem] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    Scroll to move
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Select a painting
                  </span>
                </div>

                <div className="flex flex-wrap justify-center gap-3 pt-2">
                  <Button variant="primary" onClick={() => setHasEntered(true)}>
                    Enter the gallery
                  </Button>
                  <Button variant="ghost" onClick={() => setViewMode('flat')}>
                    <PanelsTopLeft className="h-4 w-4" aria-hidden="true" />
                    Use the lighter view
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Heads-up display ── */}
          {hasEntered && !focusedId && (
            <>
              {/* Room indicator */}
              <div className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 text-center sm:top-24">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.3em] text-accent-300/80">
                  {rooms[currentRoom]?.label ?? `Room ${currentRoom + 1}`}
                </p>
                <p className="mt-1 text-[0.72rem] text-muted">
                  {Math.round(progressDisplay * 100)}% through the exhibition
                </p>
              </div>

              {/* Progress rail */}
              <div className="pointer-events-none absolute right-5 top-1/2 z-20 hidden h-44 w-[2px] -translate-y-1/2 bg-line lg:block">
                <div
                  className="w-full rounded-full bg-accent-300 transition-[height] duration-150"
                  style={{ height: `${progressDisplay * 100}%` }}
                />
                {/* Room ticks, clickable so a visitor can jump ahead. */}
                <div className="pointer-events-auto absolute inset-0">
                  {Array.from({ length: roomCount }, (_, room) => (
                    <button
                      key={room}
                      type="button"
                      onClick={() => jumpToRoom(room)}
                      className="absolute -left-1.5 h-3 w-3 rounded-full border border-surface-400 bg-surface-100 transition-colors hover:border-accent-300"
                      style={{ top: `${(room / Math.max(1, roomCount)) * 100}%` }}
                      aria-label={`Jump to room ${room + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Scroll hint, only at the very start */}
              {progressDisplay < 0.02 && (
                <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 animate-fade-in text-center">
                  <ChevronDown className="mx-auto h-5 w-5 animate-bounce text-accent-300" aria-hidden="true" />
                  <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted">
                    Scroll to walk
                  </p>
                </div>
              )}

              {/* Exit to the ordinary shop. A visitor must never feel trapped
                  in the gallery in order to buy something. */}
              <div className="absolute bottom-6 right-5 z-20 flex flex-col items-end gap-2">
                <Button variant="secondary" size="sm" to="/shop">
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Browse as a shop
                </Button>
                <button
                  type="button"
                  onClick={() => setViewMode('flat')}
                  className="text-[0.72rem] text-muted underline-offset-4 transition-colors hover:text-accent-300 hover:underline"
                >
                  Switch to the lighter view
                </button>
              </div>
            </>
          )}

          {/* ── Focused detail view ── */}
          {focusedId && (
            <ArtworkFocusPanel
              artworkId={focusedId}
              onClose={onClose}
              onSelectAlternative={(artwork) => setFocusedId(artwork.id ?? null)}
            />
          )}
        </div>
      </div>

      {/* After the corridor ends, the page continues into the ordinary shop. */}
      <section className="relative z-10 border-t border-line bg-surface-300 px-4 py-20 text-center sm:px-6">
        <p className="eyebrow">End of the exhibition</p>
        <h2 className="mt-3 text-display-md">Everything here is for sale</h2>
        <p className="lede mx-auto mt-4 max-w-xl">
          Each piece on these walls is a live listing with the same price and availability you will find
          in the shop.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button variant="primary" to="/shop">
            Browse the full collection
          </Button>
          <Button variant="secondary" to="/artists">
            Meet the artists
          </Button>
        </div>
      </section>
    </div>
  );
};

const GalleryHeader = ({ viewMode, onViewModeChange, canUse3D, total, roomCount }) => (
  <header className="border-b border-line bg-surface-300/60">
    <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-5 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <p className="eyebrow">Arts by Jay · Exhibition</p>
        <h1 className="text-display-lg">The Virtual Gallery</h1>
        <p className="lede max-w-xl">
          {total} works across {roomCount} {roomCount === 1 ? 'room' : 'rooms'}, hung on both walls.
        </p>
      </div>

      {canUse3D && (
        <div className="flex items-center gap-1 rounded-full border border-line-strong p-1">
          <button
            type="button"
            onClick={() => onViewModeChange('3d')}
            className={clsx(
              'rounded-full px-3.5 py-1.5 text-[0.78rem] transition-colors',
              viewMode === '3d' ? 'bg-accent-300 text-white' : 'text-muted hover:text-ink',
            )}
          >
            Immersive
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('flat')}
            className={clsx(
              'rounded-full px-3.5 py-1.5 text-[0.78rem] transition-colors',
              viewMode === 'flat' ? 'bg-accent-300 text-white' : 'text-muted hover:text-ink',
            )}
          >
            Lighter view
          </button>
        </div>
      )}
    </div>
  </header>
);

export default GalleryPage;
