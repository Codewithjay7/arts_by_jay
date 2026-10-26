import { Suspense, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { TextureLoader, SRGBColorSpace, DoubleSide } from 'three';
import { Text } from '@react-three/drei';
import { artworkSize } from './galleryConstants';
import { imageSource } from '../lib/images';

/** The painted surface itself, once its texture has loaded. */
const Canvas2D = ({ url, width, height }) => {
  const texture = useLoader(TextureLoader, url);

  useMemo(() => {
    // Without this the painting renders washed out and too bright.
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <mesh position={[0, 0, 0.04]}>
      <planeGeometry args={[width, height]} />
      {/* Unlit on purpose: a painting under gallery lighting should read at
          full colour while the wall around it falls away into shadow. It also
          costs far less than lighting 24 canvases individually. */}
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
};

const CanvasPlaceholder = ({ width, height }) => (
  <mesh position={[0, 0, 0.04]}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial color="#ececf0" />
  </mesh>
);

/**
 * One framed piece hanging on a wall: moulding, mount, canvas, a picture
 * light above it and a wall label beside it.
 */
export const WallArtwork = ({ artwork, isFocused, isDimmed, onSelect, quality = 'high' }) => {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef(null);
  const frameRef = useRef(null);

  const [width, height] = useMemo(() => artworkSize(artwork), [artwork]);
  const { position, rotationY, side } = artwork.gallery;

  const url = imageSource(artwork.image);
  const mount = 0.11;
  const moulding = 0.07;

  const frameWidth = width + mount * 2 + moulding * 2;
  const frameHeight = height + mount * 2 + moulding * 2;

  // A hovered or focused piece eases forward off the wall very slightly, the
  // way a lit canvas seems to step out of a dark room.
  useFrame((_state, delta) => {
    const frame = frameRef.current;
    if (!frame) return;

    const target = isFocused ? 0.16 : hovered ? 0.07 : 0;
    const damping = 1 - Math.exp(-8 * delta);
    frame.position.z += (target - frame.position.z) * damping;
  });

  const label = `${artwork.title}, ${artwork.artist?.displayName ?? 'Unknown'}`;

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      <group ref={frameRef}>
        {/* ── Outer moulding ── */}
        <mesh castShadow={quality === 'high'} receiveShadow={quality === 'high'}>
          <boxGeometry args={[frameWidth, frameHeight, 0.08]} />
          <meshStandardMaterial color="#1d1d1f" roughness={0.55} metalness={0.15} />
        </mesh>

        {/* ── Mount / mat board ── */}
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[width + mount * 2, height + mount * 2]} />
          <meshStandardMaterial color="#f5f2ed" roughness={0.9} />
        </mesh>

        {/* ── The artwork ── */}
        <Suspense fallback={<CanvasPlaceholder width={width} height={height} />}>
          {url ? <Canvas2D url={url} width={width} height={height} /> : <CanvasPlaceholder width={width} height={height} />}
        </Suspense>

        {/* ── Glass sheen: a faint diagonal highlight across the surface ── */}
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={hovered ? 0.05 : 0.02} />
        </mesh>

        {/* ── Hit area ──
             Deliberately larger than the canvas and invisible, so the piece is
             easy to click on a phone as well as with a mouse. */}
        <mesh
          position={[0, 0, 0.12]}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = '';
          }}
          onClick={(event) => {
            event.stopPropagation();
            document.body.style.cursor = '';
            onSelect?.(artwork);
          }}
        >
          <planeGeometry args={[frameWidth + 0.3, frameHeight + 0.3]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
        </mesh>
      </group>

      {/* ── Picture light ──
           A small emissive bar above the frame plus one cheap point light, so
           the wall immediately around the piece actually brightens. */}
      <mesh position={[0, frameHeight / 2 + 0.3, 0.26]} rotation={[-0.5, 0, 0]}>
        <boxGeometry args={[Math.min(frameWidth * 0.55, 1.1), 0.045, 0.1]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#fff6e8"
          emissiveIntensity={isDimmed ? 0.2 : hovered || isFocused ? 1.3 : 0.65}
          toneMapped={false}
        />
      </mesh>

      {quality !== 'low' && (
        <pointLight
          position={[0, frameHeight / 2 + 0.25, 0.75]}
          intensity={isDimmed ? 0.25 : hovered || isFocused ? 2.2 : 1.1}
          distance={4.5}
          decay={2}
          color="#fff6e8"
        />
      )}

      {/* ── Wall label ──
           A real gallery labels its work. Rendered as 3D text so it sits on
           the wall and recedes with perspective like everything else. */}
      <group position={[side === 'left' ? frameWidth / 2 + 0.42 : -(frameWidth / 2 + 0.42), -frameHeight / 2 + 0.3, 0.03]}>
        <Text
          fontSize={0.1}
          maxWidth={1.3}
          lineHeight={1.35}
          anchorX={side === 'left' ? 'left' : 'right'}
          anchorY="top"
          color={isDimmed ? '#aeaeb2' : '#6e6e73'}
          outlineWidth={0}
        >
          {label}
        </Text>
      </group>

      {/* ── Sold marker ── */}
      {artwork.isSoldOut && (
        <group position={[0, -frameHeight / 2 - 0.22, 0.06]}>
          <Text fontSize={0.11} anchorX="center" anchorY="middle" color="#0071e3" letterSpacing={0.2}>
            SOLD
          </Text>
        </group>
      )}
    </group>
  );
};
