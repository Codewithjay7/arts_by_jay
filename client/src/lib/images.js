/**
 * The API stores absolute image URLs (it has to — Cloudinary URLs are
 * absolute, and emails and webhooks need a resolvable host). In development
 * the client runs on a different port, which would make every texture a
 * cross-origin WebGL fetch.
 *
 * Rewriting a known same-machine API origin to a relative path sends the
 * request through the Vite proxy instead, so images are same-origin
 * everywhere and the 3D gallery never hits a CORS-tainted texture.
 */

const DEV_API_ORIGINS = ['http://localhost:5000', 'http://127.0.0.1:5000'];

export const assetUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  for (const origin of DEV_API_ORIGINS) {
    if (url.startsWith(origin)) return url.slice(origin.length);
  }

  return url;
};

/** Picks the smallest adequate source for a given use. */
export const imageSource = (image, { preferThumb = false } = {}) => {
  if (!image) return '';
  return assetUrl(preferThumb ? image.thumbUrl || image.url : image.url || image.thumbUrl);
};
