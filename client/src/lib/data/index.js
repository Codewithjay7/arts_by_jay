/**
 * The data layer.
 *
 * Everything the UI needs, in one import. Each module talks to Supabase
 * directly and leans on Row Level Security rather than re-checking
 * permissions in the browser — so a bug in this layer cannot become a
 * security hole, and the policies are the single description of who may see
 * what.
 *
 * The functions return the same shapes the previous Express API returned,
 * which is what let the components move across without being rewritten.
 */

export * as artworks from './artworks';
export * as auth from './auth';
export * as cart from './cart';
export * as orders from './orders';
export * as artist from './artist';
export * as admin from './admin';

import { supabase } from '../supabase';

// Vite replaces `import.meta.env` wholesale, so this inlines as before in the
// browser; it also lets Node import this module, where reading a property off
// an undefined `import.meta.env` would throw at load.
const env = import.meta.env ?? {};
import { SHIPPING_METHODS } from './cart';

export { isSupabaseConfigured, supabaseConfigError, supabase } from '../supabase';

/* ─────────────────────── Photo-to-Art studio ───────────────────────
   Static configuration. The previous build fetched this from the Express API;
   there is nothing dynamic about it, so a round trip was waste. The honesty
   note matters more than the styles: no AI provider is configured, so these
   are browser-rendered previews and the UI says exactly that. */

export const STUDIO_STYLES = [
  {
    key: 'dreamscape',
    name: 'Dreamscape',
    description: 'Soft bloom, lifted shadows and a cool wash, as if remembered rather than seen.',
    cssFilter: 'saturate(1.25) contrast(0.92) brightness(1.08) hue-rotate(-12deg) blur(0.4px)',
    overlay: 'linear-gradient(135deg, rgba(120,140,220,0.20), rgba(210,200,230,0.14))',
  },
  {
    key: 'ink_wash',
    name: 'Ink & Wash',
    description: 'Monochrome brush study with deep blacks and paper-grain highlights.',
    cssFilter: 'grayscale(1) contrast(1.45) brightness(1.04)',
    overlay: 'linear-gradient(180deg, rgba(20,20,20,0.10), rgba(250,250,252,0.18))',
  },
  {
    key: 'pop_art',
    name: 'Pop Art',
    description: 'Flattened tone, hard edges and a saturated screen-print palette.',
    cssFilter: 'saturate(2.3) contrast(1.5) brightness(1.06) hue-rotate(8deg)',
    overlay: 'linear-gradient(45deg, rgba(0,113,227,0.18), rgba(255,60,120,0.16))',
  },
  {
    key: 'golden_hour',
    name: 'Golden Hour',
    description: 'Warm low sun, amber falloff and a gentle film curve.',
    cssFilter: 'sepia(0.35) saturate(1.5) contrast(1.08) brightness(1.06)',
    overlay: 'linear-gradient(160deg, rgba(255,186,73,0.22), rgba(190,120,60,0.12))',
  },
];

export const getStudioConfig = async () => ({
  styles: STUDIO_STYLES,
  aiGeneration: {
    enabled: false,
    provider: null,
    notice:
      'Style previews are rendered in your browser only. Your photo stays on your device unless you choose to send it with a commission request.',
  },
  maxUploadMb: 8,
});

/* ─────────────────────── Capability reporting ───────────────────────
   What this deployment can actually do. The UI uses it to disable or explain
   a feature instead of letting it look functional and then fail. */

export const getCapabilities = async () => {
  let commissionPercent = 10;
  let routeEnabled = false;

  if (supabase) {
    const { data } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['commission_percent', 'razorpay_route_enabled']);

    const map = new Map((data ?? []).map((row) => [row.key, row.value]));
    commissionPercent = Number(map.get('commission_percent') ?? 10);
    routeEnabled = map.get('razorpay_route_enabled') === 'true';
  }

  /**
   * Checkout needs the create-order and verify-payment Edge Functions. Their
   * presence is not something the browser can probe cheaply, so it is
   * declared by build configuration. Set VITE_CHECKOUT_ENABLED=true only
   * once `supabase functions deploy` has actually run.
   */
  const checkoutEnabled = env.VITE_CHECKOUT_ENABLED === 'true';

  return {
    payment: {
      enabled: checkoutEnabled,
      provider: 'razorpay',
      // Public by design: the Key ID is handed to Razorpay's checkout
      // script in the browser. The Key SECRET is an Edge Function secret
      // and must never appear here.
      keyId: env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TsPMzji5nqQ09l',
      currency: 'INR',
      isSimulated: false,
      reason: checkoutEnabled
        ? undefined
        : 'Checkout is not live on this deployment yet: the payment Edge Functions have not been deployed.',
    },
    storage: { driver: 'supabase', maxUploadMb: 8 },
    aiPhotoStudio: false,
    emailDelivery: false,
    currency: 'INR',
    commissionPercent,
    // Route being unapproved is why artist payouts are a ledger, not transfers.
    routeEnabled,
  };
};

export const getCheckoutConfig = async () => {
  const capabilities = await getCapabilities();

  return {
    payment: capabilities.payment,
    shippingMethods: SHIPPING_METHODS,
    commissionPercent: capabilities.commissionPercent,
  };
};
