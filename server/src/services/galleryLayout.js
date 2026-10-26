/**
 * Lays artwork out along the immersive gallery corridor.
 *
 * The server owns the layout so the 3D client and any fallback view agree on
 * which piece sits where, and so a room/slot can be deep-linked and restored
 * exactly when a visitor returns from a detail view.
 */

export const SLOTS_PER_ROOM = 6; // 3 per wall
export const SPACING = 7; // metres between slot centres along the corridor
export const ROOM_LENGTH = (SLOTS_PER_ROOM / 2) * SPACING;
export const WALL_X = 5.6; // distance of each wall from the corridor centre
export const ART_Y = 2.3; // hanging height of the artwork centre

/**
 * Walks the ordered artwork list and assigns each piece a room, a wall and a
 * world position. Slots alternate left/right so a visitor always has art on
 * both sides as they move forward.
 */
export const layoutArtworks = (artworks) =>
  artworks.map((artwork, index) => {
    const room = Math.floor(index / SLOTS_PER_ROOM);
    const slotInRoom = index % SLOTS_PER_ROOM;
    const side = slotInRoom % 2 === 0 ? 'left' : 'right';
    const depthIndex = Math.floor(slotInRoom / 2);

    // Depth grows continuously through the whole corridor, not per room, so
    // scroll progress maps straight onto a single forward axis.
    const z = -(room * ROOM_LENGTH + depthIndex * SPACING + SPACING);

    return {
      ...artwork,
      gallery: {
        index,
        room,
        roomLabel: `Room ${String(room + 1).padStart(2, '0')}`,
        slot: slotInRoom,
        side,
        position: [side === 'left' ? -WALL_X : WALL_X, ART_Y, z],
        // Each canvas faces the corridor centre.
        rotationY: side === 'left' ? Math.PI / 2 : -Math.PI / 2,
        // Camera stop that frames this piece head-on.
        viewpoint: [side === 'left' ? -1.9 : 1.9, ART_Y - 0.35, z],
      },
    };
  });

export const describeRooms = (laidOut) => {
  const rooms = new Map();

  laidOut.forEach((item) => {
    const { room, roomLabel } = item.gallery;
    if (!rooms.has(room)) {
      rooms.set(room, { room, label: roomLabel, count: 0, startZ: item.gallery.position[2], endZ: item.gallery.position[2] });
    }
    const entry = rooms.get(room);
    entry.count += 1;
    entry.endZ = Math.min(entry.endZ, item.gallery.position[2]);
  });

  return [...rooms.values()].sort((a, b) => a.room - b.room);
};

/** Total forward distance the camera travels, plus a little room to exit. */
export const corridorLength = (laidOut) => {
  if (!laidOut.length) return SPACING * 2;
  const deepest = Math.min(...laidOut.map((item) => item.gallery.position[2]));
  return Math.abs(deepest) + SPACING * 1.5;
};
