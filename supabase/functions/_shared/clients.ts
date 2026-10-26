import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

/**
 * Two Supabase clients, used for deliberately different jobs.
 *
 * `userClient` carries the caller's JWT, so every query it makes is subject to
 * Row Level Security — it can only see what that user may see. Use it to work
 * out WHO is asking.
 *
 * `serviceClient` uses the service-role key and bypasses RLS entirely. It is
 * the only thing that may write to the money tables. Never derive what a user
 * is allowed to do from this client; check with `userClient` first.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const userClient = (req: Request): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const serviceClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Resolves the caller, or null. Always re-reads the role from the database. */
export const requireUser = async (req: Request) => {
  const supabase = userClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;

  // The role in the JWT is not trusted; `profiles` is the source of truth.
  const { data: profile } = await serviceClient()
    .from('profiles')
    .select('id, email, role, is_active, full_name')
    .eq('id', data.user.id)
    .single();

  if (!profile || !profile.is_active) return null;
  return profile;
};

/* ────────────────────────────── Razorpay ────────────────────────────── */

const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

export const razorpayConfigured = () => Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

export const razorpayKeyId = () => RAZORPAY_KEY_ID;

export const razorpay = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
  if (!razorpayConfigured()) {
    throw new Error('Razorpay keys are not configured on this server.');
  }

  const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { ok: response.ok, status: response.status, data };
};

/* ──────────────────────── HMAC verification ──────────────────────── */

const encoder = new TextEncoder();

const hmacKey = async (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

export const hmacHex = async (secret: string, message: string | Uint8Array): Promise<string> => {
  const key = await hmacKey(secret);
  const payload = typeof message === 'string' ? encoder.encode(message) : message;
  const signature = await crypto.subtle.sign('HMAC', key, payload);

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** Constant-time comparison, so a wrong signature leaks nothing by timing. */
export const safeEqual = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

/**
 * Verifies the HMAC Razorpay hands the browser. This is what makes a
 * client-reported payment trustworthy: the signature covers
 * `<order_id>|<payment_id>` and only Razorpay and this server know the secret.
 */
export const verifyPaymentSignature = async (
  providerOrderId: string,
  providerPaymentId: string,
  signature: string,
): Promise<boolean> => {
  if (!providerOrderId || !providerPaymentId || !signature) return false;
  const expected = await hmacHex(RAZORPAY_KEY_SECRET, `${providerOrderId}|${providerPaymentId}`);
  return safeEqual(expected, signature);
};

export const verifyWebhookSignature = async (
  rawBody: Uint8Array,
  signature: string | null,
): Promise<boolean> => {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
  if (!secret || !signature) return false;
  const expected = await hmacHex(secret, rawBody);
  return safeEqual(expected, signature);
};

export const auditLog = async (
  supabase: SupabaseClient,
  entry: {
    actor_id?: string | null;
    actor_role?: string | null;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    detail?: Record<string, unknown>;
  },
) => {
  // Audit failures must never break the operation being audited.
  await supabase
    .from('audit_logs')
    .insert({ ...entry, detail: entry.detail ?? {} })
    .then(({ error }) => {
      if (error) console.error('[audit] failed:', error.message);
    });
};
