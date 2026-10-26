/**
 * Geometry shared by the 3D scene, the scroll mapping and the fallback view.
 * These mirror the server's layout service (src/services/galleryLayout.js) so
 * the client and server agree on where every piece hangs.
 */

export const SLOTS_PER_ROOM = 6;
export const SPACING = 7;
export const ROOM_LENGTH = (SLOTS_PER_ROOM / 2) * SPACING;

/** Where the walls stand. Artwork hangs just in front of them. */
export const WALL_X = 6;
export const ART_WALL_X = 5.85;

export const CORRIDOR_HEIGHT = 5.2;
export const EYE_HEIGHT = 1.68;
export const ART_CENTRE_Y = 2.3;

/** How much page scroll equals one metre walked. */
export const PX_PER_METRE = 110;

/** The largest side of a hung canvas, in metres. */
export const MAX_ART_SIZE = 2.1;

/**
 * Turns an artwork's real dimensions into a plausible hung size. Falls back to
 * its orientation when the artist left dimensions blank, so the wall never
 * shows a stretched or zero-sized canvas.
 */
export const artworkSize = (artwork) => {
  const width = Number(artwork.dimensions?.width) || 0;
  const height = Number(artwork.dimensions?.height) || 0;

  if (width > 0 && height > 0) {
    const unit = artwork.dimensions?.unit === 'in' ? 2.54 : 1;
    const widthM = (width * unit) / 100;
    const heightM = (height * unit) / 100;

    // Scale the piece so its longest side reads well on the wall while
    // keeping its true aspect ratio.
    const scale = MAX_ART_SIZE / Math.max(widthM, heightM);
    const factor = Math.min(1.35, Math.max(0.75, scale));

    return [Math.max(0.4, widthM * factor), Math.max(0.4, heightM * factor)];
  }

  if (artwork.orientation === 'landscape') return [1.95, 1.35];
  if (artwork.orientation === 'square') return [1.6, 1.6];
  return [1.4, 1.85];
};

/** The depth the camera travels, derived from the deepest hung piece. */
export const corridorLengthFor = (artworks) => {
  if (!artworks?.length) return SPACING * 3;
  const deepest = Math.min(...artworks.map((item) => item.gallery.position[2]));
  return Math.abs(deepest) + SPACING * 2;
};

export const roomIndexForZ = (z) => Math.max(0, Math.floor(Math.abs(z) / ROOM_LENGTH));
