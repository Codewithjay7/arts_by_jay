import { createClient } from '@supabase/supabase-js';

/**
 * The Supabase browser client.
 *
 * This client holds the ANON key, which is public by design — it ships inside
 * the JavaScript bundle and anyone can read it. What protects the data is Row
 * Level Security in the database, not the secrecy of this key. The
 * service-role key must never appear anywhere in `client/`.
 */

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * True only when both values are present. The app checks this before using
 * any Supabase path, so a missing key produces a clear message instead of a
 * stack trace from deep inside a query.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabaseConfigError = !url
  ? 'VITE_SUPABASE_URL is not set.'
  : !anonKey
    ? 'VITE_SUPABASE_ANON_KEY is not set.'
    : null;

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // The session lives in localStorage and is refreshed in the
        // background; Supabase handles rotation for us.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'abj-auth',
      },
      global: {
        headers: { 'x-application-name': 'arts-by-jay' },
      },
      db: { schema: 'public' },
    })
  : null;

/** Guard for every call site, so a misconfiguration fails loudly and early. */
const client = () => {
  if (!supabase) {
    throw new Error(
      `Supabase is not configured. ${supabaseConfigError} Copy client/.env.example to client/.env and fill it in.`,
    );
  }
  return supabase;
};

export default client;

/* ──────────────────────────── Error handling ──────────────────────────── */

/**
 * Turns a PostgREST or Postgres error into something a person can act on.
 *
 * The database raises deliberate, readable messages from its triggers (for
 * example "Only an administrator can change an artist approval status"), so
 * those are surfaced as-is. Opaque codes get a human translation instead.
 */
export const supabaseError = (error, fallback = 'Something went wrong. Please try again.') => {
  if (!error) return fallback;

  const code = error.code ?? '';
  const message = error.message ?? '';

  // Our own guard triggers raise with these SQLSTATEs and a written reason.
  if (code === '42501' || code === 'P0001' || code === '23514') {
    return message || 'That action is not permitted.';
  }

  switch (code) {
    case '23505':
    case '23P01':
      return /email/i.test(message)
        ? 'An account with that email already exists.'
        : 'That already exists.';
    case '23503':
      return 'That refers to something which no longer exists.';
    case '22P02':
      return 'That identifier is not valid.';
    case 'PGRST116':
      // "no rows returned" from .single() — usually RLS hiding a row.
      return 'Not found, or you do not have access to it.';
    case 'PGRST301':
      return 'Your session has expired. Please sign in again.';
    default:
      break;
  }

  if (/row-level security/i.test(message)) {
    return 'You do not have permission to do that.';
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'We could not reach the server. Check your connection.';
  }

  return message || fallback;
};

/** Unwraps a Supabase result, throwing a readable Error on failure. */
export const unwrap = ({ data, error }, context = '') => {
  if (error) {
    const readable = supabaseError(error);
    const wrapped = new Error(context ? `${context}: ${readable}` : readable);
    wrapped.cause = error;
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
};

/* ──────────────────────────── Storage ──────────────────────────── */

/**
 * Uploads one image into a bucket under the caller's own id.
 *
 * The leading path segment MUST be the user's id: the storage policies
 * require `(storage.foldername(name))[1] = auth.uid()`, which is what stops
 * one artist writing into another's folder. The filename is randomised rather
 * than taken from the client, so a crafted name cannot traverse or collide.
 */
export const uploadImage = async (bucket, userId, file, { prefix = '' } = {}) => {
  const db = client();

  const extension = (file.name?.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExtension = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(extension) ? extension : 'jpg';
  const unique = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

  const path = [userId, prefix, `${unique}.${safeExtension}`].filter(Boolean).join('/');

  const { error } = await db.storage.from(bucket).upload(path, file, {
    cacheControl: '604800',
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new Error(supabaseError(error, 'That image could not be uploaded.'));

  // Public buckets get a stable URL; the private one needs a signed URL.
  if (bucket === 'commission-references') {
    const { data: signed } = await db.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    return { path, url: signed?.signedUrl ?? '', bucket };
  }

  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl, bucket };
};

export const removeImage = async (bucket, path) => {
  if (!path) return;
  // Best effort: a failed cleanup must not fail the parent operation.
  await client()
    .storage.from(bucket)
    .remove([path])
    .catch(() => {});
};

/* ───────────────────── Error helpers for components ───────────────────── */

/**
 * Reads a displayable message off anything thrown by the data layer.
 *
 * The data layer throws plain `Error`s whose message has already been made
 * readable by `supabaseError`, so this is mostly a null-safe accessor. It
 * exists as a named helper because the components call it in ~35 places and a
 * single function is easier to change than 35 call sites.
 */
export const errorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
};

/**
 * Field-level validation errors.
 *
 * Always null, and deliberately so. The Express build validated with Zod and
 * could say "price: must be positive"; Postgres raises one error for the
 * whole statement, so there is nothing to map to a field. The forms already
 * handle null by showing the message at the top instead, which is honest —
 * inventing a field attribution would point at the wrong input.
 */
export const errorDetails = () => null;
