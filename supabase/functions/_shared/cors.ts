/** Shared CORS handling. The allowed origin is configuration, not a wildcard. */

const allowed = (Deno.env.get('SITE_URL') ?? 'http://localhost:5173')
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
