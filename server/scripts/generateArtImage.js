import zlib from 'node:zlib';

/**
 * A minimal PNG encoder plus a procedural abstract-art generator.
 *
 * The seed catalogue needs real raster images: hotlinking stock photos would
 * break offline and SVG files served from the upload directory are an XSS
 * risk. Encoding PNGs here keeps the seeded gallery self-contained with no
 * extra dependency and no untrusted markup.
 */

const crc32Table = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
};

/** Encodes raw RGB pixel data (width * height * 3) as a PNG buffer. */
export const encodePng = (width, height, rgb) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* ──────────────────── Procedural composition ──────────────────── */

/** Deterministic PRNG so the same seed always yields the same painting. */
const makeRandom = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
};

const hexToRgb = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const mix = (a, b, t) => a + (b - a) * t;
const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Builds an abstract composition from a palette: a soft directional gradient,
 * a few low-frequency colour fields, a horizon band and a light film grain.
 */
export const generateArtwork = ({ width, height, palette, seed = 1 }) => {
  const random = makeRandom(seed * 2654435761);
  const colours = palette.map(hexToRgb);

  // Low-frequency blobs give the piece its shapes.
  const blobCount = 3 + Math.floor(random() * 3);
  const blobs = Array.from({ length: blobCount }, () => ({
    cx: random(),
    cy: random(),
    radius: 0.25 + random() * 0.45,
    colour: colours[Math.floor(random() * colours.length)],
    strength: 0.5 + random() * 0.6,
  }));

  const angle = random() * Math.PI * 2;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  const horizon = 0.3 + random() * 0.4;
  const horizonSoftness = 0.04 + random() * 0.12;
  const bandColour = colours[Math.floor(random() * colours.length)];

  const base = colours[0];
  const accent = colours[colours.length - 1];

  const rgb = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);

    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);

      // Directional gradient between the first and last palette colours.
      const projection = smoothstep(Math.max(0, Math.min(1, (u * dirX + v * dirY + 1) / 2)));
      let r = mix(base[0], accent[0], projection);
      let g = mix(base[1], accent[1], projection);
      let b = mix(base[2], accent[2], projection);

      // Accumulate the colour fields with a smooth radial falloff.
      blobs.forEach((blob) => {
        const dx = u - blob.cx;
        const dy = (v - blob.cy) * (height / width);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance >= blob.radius) return;

        const weight = smoothstep(1 - distance / blob.radius) * blob.strength;
        r = mix(r, blob.colour[0], weight * 0.7);
        g = mix(g, blob.colour[1], weight * 0.7);
        b = mix(b, blob.colour[2], weight * 0.7);
      });

      // A horizon band reads as land, water or a hard colour field.
      const bandWeight = Math.exp(-((v - horizon) ** 2) / (2 * horizonSoftness ** 2));
      r = mix(r, bandColour[0], bandWeight * 0.35);
      g = mix(g, bandColour[1], bandWeight * 0.35);
      b = mix(b, bandColour[2], bandWeight * 0.35);

      // Vignette, so the piece sits inside its frame rather than bleeding out.
      const vignette = 1 - 0.35 * ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2.4;
      r *= vignette;
      g *= vignette;
      b *= vignette;

      // Fine grain keeps large flat areas from banding.
      const grain = (random() - 0.5) * 9;

      const offset = (y * width + x) * 3;
      rgb[offset] = clamp255(r + grain);
      rgb[offset + 1] = clamp255(g + grain);
      rgb[offset + 2] = clamp255(b + grain);
    }
  }

  return encodePng(width, height, rgb);
};

/** A nearest-neighbour downscale, used to produce grid thumbnails. */
export const generateThumbnail = ({ width, height, palette, seed, scale = 0.35 }) => {
  const thumbWidth = Math.max(64, Math.round(width * scale));
  const thumbHeight = Math.max(64, Math.round(height * scale));
  return generateArtwork({ width: thumbWidth, height: thumbHeight, palette, seed });
};
