import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

export const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

/**
 * Magic-number check. A client can claim any MIME type and any extension, so
 * the only trustworthy signal is the file's own leading bytes.
 */
const sniffImage = (buffer) => {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
  }
  return null;
};

export const assertIsImage = (file) => {
  const sniffed = sniffImage(file.buffer);
  if (!sniffed) {
    throw ApiError.badRequest('That file is not a JPEG, PNG, WebP or AVIF image.');
  }
  if (!ALLOWED_MIME.has(sniffed)) {
    throw ApiError.badRequest('That image format is not supported.');
  }
  return sniffed;
};

let cloudinaryClient = null;

const getCloudinary = async () => {
  if (cloudinaryClient) return cloudinaryClient;

  const { cloudName, apiKey, apiSecret } = env.storage.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw ApiError.notConfigured(
      'Cloudinary is selected as the storage driver but its credentials are not configured.',
    );
  }

  const { v2 } = await import('cloudinary');
  v2.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  cloudinaryClient = v2;
  return cloudinaryClient;
};

const uploadToCloudinary = async (file, { folder }) => {
  const cloudinary = await getCloudinary();

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `arts-by-jay/${folder}`, resource_type: 'image' },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded)),
    );
    stream.end(file.buffer);
  });

  return {
    url: result.secure_url,
    thumbUrl: cloudinary.url(result.public_id, {
      secure: true,
      width: 600,
      crop: 'limit',
      quality: 'auto',
      fetch_format: 'auto',
    }),
    publicId: result.public_id,
    width: result.width,
    height: result.height,
  };
};

const uploadToLocalDisk = async (file, { folder, mime }) => {
  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  const ext = ALLOWED_MIME.get(mime) ?? '.bin';
  // Random name: never reuse a client-supplied filename on disk.
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const absolute = path.join(dir, name);

  await fs.writeFile(absolute, file.buffer);

  const relative = `/uploads/${folder}/${name}`;
  const url = `${env.publicApiUrl}${relative}`;
  return { url, thumbUrl: url, publicId: `${folder}/${name}`, width: 0, height: 0 };
};

/**
 * Stores one validated image and returns the shape the Artwork image
 * sub-document expects.
 */
export const storeImage = async (file, { folder = 'misc' } = {}) => {
  const mime = assertIsImage(file);

  if (env.storage.driver === 'cloudinary') {
    return uploadToCloudinary(file, { folder });
  }
  return uploadToLocalDisk(file, { folder, mime });
};

export const storeImages = (files, options) => Promise.all(files.map((file) => storeImage(file, options)));

/** Best-effort removal; a failure here must never fail the parent request. */
export const removeImage = async (publicId) => {
  if (!publicId) return;

  try {
    if (env.storage.driver === 'cloudinary') {
      const cloudinary = await getCloudinary();
      await cloudinary.uploader.destroy(publicId);
      return;
    }

    const absolute = path.join(UPLOAD_ROOT, publicId);
    // Containment check: never let a crafted publicId escape the upload root.
    if (!absolute.startsWith(UPLOAD_ROOT)) return;
    await fs.unlink(absolute);
  } catch (err) {
    console.warn('[storage] could not remove image', publicId, err.message);
  }
};
