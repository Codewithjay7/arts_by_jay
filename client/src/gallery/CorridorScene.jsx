import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { WallArtwork } from './WallArtwork';
import {
  ART_CENTRE_Y,
  CORRIDOR_HEIGHT,
  EYE_HEIGHT,
  ROOM_LENGTH,
  SPACING,
  WALL_X,
} from './galleryConstants';

/* ──────────────────────────── Architecture ──────────────────────────── */

const Architecture = ({ length, quality }) => {
  const segments = quality === 'low' ? 1 : 8;

  return (
    <group>
      {/* ── Floor ──
           Slightly reflective dark stone. The camera sits above it, so this is
           what gives the corridor its sense of ground and vanishing point. */}
      <mesh
        position={[0, 0, -length / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={quality === 'high'}
      >
        <planeGeometry args={[WALL_X * 2, length + SPACING * 2, segments, segments]} />
        <meshStandardMaterial color="#14160f" roughness={0.42} metalness={0.3} />
      </mesh>

      {/* A darker runner down the centre, which reads as a deliberate path. */}
      <mesh position={[0, 0.005, -length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.4, length + SPACING * 2]} />
        <meshStandardMaterial color="#0e100a" roughness={0.85} />
      </mesh>

      {/* ── Ceiling ── */}
      <mesh position={[0, CORRIDOR_HEIGHT, -length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WALL_X * 2, length + SPACING * 2]} />
        <meshStandardMaterial color="#0a0b08" roughness={1} />
      </mesh>

      {/* ── Side walls ── */}
      {[-1, 1].map((direction) => (
        <mesh
          key={direction}
          position={[direction * WALL_X, CORRIDOR_HEIGHT / 2, -length / 2]}
          rotation={[0, direction > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          receiveShadow={quality === 'high'}
        >
          <planeGeometry args={[length + SPACING * 2, CORRIDOR_HEIGHT]} />
          <meshStandardMaterial color="#1d2118" roughness={0.95} />
        </mesh>
      ))}

      {/* ── Skirting ── a hairline of lighter tone where wall meets floor. */}
      {[-1, 1].map((direction) => (
        <mesh
          key={`skirt-${direction}`}
          position={[direction * (WALL_X - 0.02), 0.09, -length / 2]}
          rotation={[0, direction > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
        >
          <planeGeometry args={[length + SPACING * 2, 0.18]} />
          <meshStandardMaterial color="#2a2f22" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * The openings between rooms. Each divider narrows the corridor with a pier on
 * either side and a header beam above, which is what makes moving forward feel
 * like passing from one space into the next rather than sliding along one wall.
 */
const RoomDividers = ({ roomCount, quality }) => {
  const dividers = [];

  for (let room = 1; room < roomCount; room += 1) {
    const z = -(room * ROOM_LENGTH);
    const openingHalfWidth = 2.1;
    const pierWidth = WALL_X - openingHalfWidth;

    dividers.push(
      <group key={room} position={[0, 0, z]}>
        {[-1, 1].map((direction) => (
          <mesh
            key={direction}
            position={[direction * (openingHalfWidth + pierWidth / 2), CORRIDOR_HEIGHT / 2, 0]}
            castShadow={quality === 'high'}
          >
            <boxGeometry args={[pierWidth, CORRIDOR_HEIGHT, 0.5]} />
            <meshStandardMaterial color="#171a12" roughness={0.95} />
          </mesh>
        ))}

        {/* Header above the opening */}
        <mesh position={[0, CORRIDOR_HEIGHT - 0.7, 0]} castShadow={quality === 'high'}>
          <boxGeometry args={[openingHalfWidth * 2, 1.4, 0.5]} />
          <meshStandardMaterial color="#171a12" roughness={0.95} />
        </mesh>

        {/* A thin lime reveal around the opening: the one piece of brand
            colour in the architecture, and a strong depth cue. */}
        <mesh position={[0, CORRIDOR_HEIGHT - 1.42, 0.27]}>
          <boxGeometry args={[openingHalfWidth * 2, 0.025, 0.02]} />
          <meshStandardMaterial
            color="#c5ff3d"
            emissive="#c5ff3d"
            emissiveIntensity={1.6}
            toneMapped={false}
          />
        </mesh>
      </group>,
    );
  }

  return <group>{dividers}</group>;
};

/** Ceiling washes, spaced down the corridor. */
const CorridorLighting = ({ length, quality }) => {
  const washes = useMemo(() => {
    const count = Math.max(2, Math.ceil(length / SPACING));
    return Array.from({ length: count }, (_, index) => -(index * SPACING + SPACING / 2));
  }, [length]);

  return (
    <group>
      {/* A low ambient keeps the darkest corners from going pure black. */}
      <ambientLight intensity={0.22} color="#aab79a" />

      {/* A single soft fill from above and behind the visitor. */}
      <directionalLight position={[2, CORRIDOR_HEIGHT, 4]} intensity={0.25} color="#dfe9cd" />

      {washes.map((z, index) => (
        <group key={z} position={[0, CORRIDOR_HEIGHT - 0.12, z]}>
          {/* The visible fixture */}
          <mesh>
            <boxGeometry args={[2.6, 0.06, 0.14]} />
            <meshStandardMaterial
              color="#e8f5c8"
              emissive="#e8f5c8"
              emissiveIntensity={0.9}
              toneMapped={false}
            />
          </mesh>

          {/* Only every other fixture actually casts light on lower tiers,
              which halves the lighting cost without changing the look much. */}
          {(quality === 'high' || index % 2 === 0) && (
            <pointLight position={[0, -0.4, 0]} intensity={2.6} distance={9} decay={2} color="#d8e6bd" />
          )}
        </group>
      ))}
    </group>
  );
};

/* ──────────────────────────── Camera rig ──────────────────────────── */

const FORWARD_LOOK = 14;

/**
 * Drives the camera.
 *
 * Two modes, blended by a critically damped easing so neither snaps:
 *
 *  - Walking: the camera's depth follows the scroll position. A faint lateral
 *    sway and bob make it read as a person moving rather than a dolly.
 *  - Focused: the camera eases to the selected piece's viewpoint and turns to
 *    face it. Page scroll is locked while focused, and because we never change
 *    scrollTop, releasing focus returns the visitor to the exact spot in the
 *    corridor they left.
 */
const CameraRig = ({ scrollRef, focusedArtwork, length, reducedMotion }) => {
  const { camera } = useThree();

  const lookTarget = useRef(new Vector3(0, EYE_HEIGHT, -FORWARD_LOOK));
  const currentLook = useRef(new Vector3(0, EYE_HEIGHT, -FORWARD_LOOK));
  const elapsed = useRef(0);

  useFrame((_state, delta) => {
    elapsed.current += delta;

    const progress = scrollRef.current ?? 0;
    const walkZ = -progress * length;

    let targetX = 0;
    let targetY = EYE_HEIGHT;
    let targetZ = walkZ;

    if (focusedArtwork) {
      const [vx, vy, vz] = focusedArtwork.gallery.viewpoint;
      targetX = vx;
      targetY = vy;
      targetZ = vz;

      const [ax, ay, az] = focusedArtwork.gallery.position;
      lookTarget.current.set(ax, ay, az);
    } else {
      if (!reducedMotion) {
        // Gentle gait. Small enough to feel human, not enough to nauseate.
        targetX = Math.sin(elapsed.current * 0.55) * 0.16;
        targetY = EYE_HEIGHT + Math.sin(elapsed.current * 1.25) * 0.022;
      }
      lookTarget.current.set(targetX * 0.4, ART_CENTRE_Y - 0.5, walkZ - FORWARD_LOOK);
    }

    // Exponential damping: frame-rate independent, and never overshoots.
    const positionDamping = 1 - Math.exp(-(focusedArtwork ? 3.4 : 7) * delta);
    camera.position.x += (targetX - camera.position.x) * positionDamping;
    camera.position.y += (targetY - camera.position.y) * positionDamping;
    camera.position.z += (targetZ - camera.position.z) * positionDamping;

    const lookDamping = 1 - Math.exp(-(focusedArtwork ? 3.8 : 6) * delta);
    currentLook.current.lerp(lookTarget.current, lookDamping);
    camera.lookAt(currentLook.current);

    // Easing the field of view in gives the focus transition its cinematic
    // push-in, rather than only moving the camera closer.
    const targetFov = focusedArtwork ? 38 : 55;
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * delta));
    camera.updateProjectionMatrix();
  });

  return null;
};

/* ──────────────────────────── Scene ──────────────────────────── */

export const CorridorScene = ({
  artworks,
  scrollRef,
  focusedArtwork,
  onSelect,
  length,
  roomCount,
  quality = 'high',
  reducedMotion = false,
}) => (
  <>
    <color attach="background" args={['#070806']} />
    {/* Fog hides the far end of the corridor, which both sells the depth and
        means distant rooms cost nothing to look at. */}
    <fog attach="fog" args={['#070806', 10, 46]} />

    <CameraRig
      scrollRef={scrollRef}
      focusedArtwork={focusedArtwork}
      length={length}
      reducedMotion={reducedMotion}
    />

    <CorridorLighting length={length} quality={quality} />
    <Architecture length={length} quality={quality} />
    <RoomDividers roomCount={roomCount} quality={quality} />

    {artworks.map((artwork) => (
      <WallArtwork
        key={artwork.id}
        artwork={artwork}
        isFocused={focusedArtwork?.id === artwork.id}
        isDimmed={Boolean(focusedArtwork) && focusedArtwork.id !== artwork.id}
        onSelect={onSelect}
        quality={quality}
      />
    ))}
  </>
);
