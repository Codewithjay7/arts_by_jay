/** Shared CORS handling. The allowed origin is configuration, not a wildcard. */

/**
 * The origins allowed to call these functions from a browser.
 *
 * SITE_URL (comma-separated) overrides this entirely, so another deployment
 * can point somewhere else. The default lists the real production origin
 * because the fallback used to be localhost alone: with SITE_URL unset, a
 * preflight from artsbyjay.netlify.app was answered with
 * `Access-Control-Allow-Origin: http://localhost:5173` and the browser
 * blocked checkout. An origin is a public value - this gives nothing away,
 * and it is not a wildcard: an unrecognised origin still gets the first
 * entry, never its own.
 */
const DEFAULT_ALLOWED_ORIGINS = 'https://artsbyjay.netlify.app,http://localhost:5173';

const allowed = (Deno.env.get('SITE_URL') ?? DEFAULT_ALLOWED_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsHeaders = (origin: string | null): Record<string, string> => {
  // Echo the origin only when it is one we recognise, so credentialed
  // requests cannot be made from an arbitrary site.
  const resolved = origin && allowed.includes(origin) ? origin : allowed[0];

  return {
    'Access-Control-Allow-Origin': resolved,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};

export const preflight = (req: Request): Response | null => {
  if (req.method !== 'OPTIONS') return null;
  return new Response('ok', { headers: corsHeaders(req.headers.get('origin')) });
};

export const json = (req: Request, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
  });

export const fail = (req: Request, status: number, message: string, code?: string): Response =>
  json(req, { error: { message, ...(code ? { code } : {}) } }, status);
