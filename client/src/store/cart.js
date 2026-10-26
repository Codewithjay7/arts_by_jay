import { create } from 'zustand';
import * as cartData from '../lib/data/cart';
import { useUi } from './ui';

const EMPTY_TOTALS = {
  subtotalMinor: 0,
  shippingTotalMinor: 0,
  discountMinor: 0,
  totalMinor: 0,
  currency: 'INR',
  itemCount: 0,
};

/**
 * Cart state.
 *
 * The cart lives in Postgres, so it survives a reload and follows the
 * customer between devices. This store is only a cache of the server's
 * answer: every mutation round-trips and the re-priced response replaces
 * local state wholesale. Nothing here computes a total — the database does,
 * which is the same reason the browser is never trusted with a price.
 */
export const useCart = create((set, get) => ({
  items: [],
  totals: EMPTY_TOTALS,
  issues: [],
  shippingMethods: cartData.SHIPPING_METHODS,
  shippingMethod: 'standard',
  canProceed: false,
  status: 'idle', // idle | loading | ready | error
  error: null,
  pendingIds: [],

  isPending: (artworkId) => get().pendingIds.includes(artworkId),

  markPending: (id, pending) =>
    set((state) => ({
      pendingIds: pending
        ? [...new Set([...state.pendingIds, id])]
        : state.pendingIds.filter((entry) => entry !== id),
    })),

  apply: (data) =>
    set({
      items: data.items ?? [],
      totals: data.totals ?? EMPTY_TOTALS,
      issues: data.issues ?? [],
      shippingMethods: data.shippingMethods ?? cartData.SHIPPING_METHODS,
      shippingMethod: data.shippingMethod ?? get().shippingMethod,
      canProceed: data.canProceed ?? false,
      status: 'ready',
      error: null,
    }),

  reset: () =>
    set({ items: [], totals: EMPTY_TOTALS, issues: [], canProceed: false, status: 'idle', error: null }),

  load: async ({ silent = false } = {}) => {
    if (!silent) set({ status: 'loading' });

    try {
      const data = await cartData.getCart({ shippingMethod: get().shippingMethod });
      get().apply(data);

      // The database adjusts quantities when stock moved. Say so, rather than
      // letting the number change under the customer silently.
      (data.issues ?? [])
        .filter((issue) => issue.kind === 'quantity_reduced' || issue.kind === 'sold_out')
        .forEach((issue) => useUi.getState().info('Your cart changed', issue.message));

      return data;
    } catch (error) {
      set({ status: 'error', error: error.message });
      return null;
    }
  },

  add: async (artwork, quantity = 1) => {
    const id = artwork.id ?? artwork;
    get().markPending(id, true);

    try {
      const data = await cartData.addToCart(id, quantity);
      get().apply(data);
      useUi.getState().success('Added to your cart', artwork.title ? `"${artwork.title}"` : '');
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Not added', error.message);
      return { ok: false, message: error.message };
    } finally {
      get().markPending(id, false);
    }
  },

  setQuantity: async (artworkId, quantity) => {
    get().markPending(artworkId, true);

    try {
      const data = await cartData.setCartQuantity(artworkId, quantity);
      get().apply(data);
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Not updated', error.message);
      // Re-sync so the UI shows what the database actually holds.
      await get().load({ silent: true });
      return { ok: false, message: error.message };
    } finally {
      get().markPending(artworkId, false);
    }
  },

  remove: async (artworkId) => {
    get().markPending(artworkId, true);
    try {
      const data = await cartData.removeFromCart(artworkId);
      get().apply(data);
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Not removed', error.message);
      return { ok: false };
    } finally {
      get().markPending(artworkId, false);
    }
  },

  clear: async () => {
    try {
      const data = await cartData.clearCart();
      get().apply(data);
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Could not empty your cart', error.message);
      return { ok: false };
    }
  },

  setShippingMethod: async (method) => {
    set({ shippingMethod: method });
    try {
      const data = await cartData.getCart({ shippingMethod: method });
      get().apply(data);
    } catch {
      // Keep the chosen method; checkout re-prices authoritatively anyway.
    }
  },

  has: (artworkId) => get().items.some((item) => item.artwork.id === artworkId),

  quantityOf: (artworkId) => get().items.find((item) => item.artwork.id === artworkId)?.quantity ?? 0,
}));

/**
 * Wishlist state. Small enough to live beside the cart, and used by the same
 * card components.
 */
export const useWishlist = create((set, get) => ({
  ids: [],
  items: [],
  status: 'idle',

  load: async () => {
    set({ status: 'loading' });
    try {
      const data = await cartData.getWishlist();
      set({ items: data.items, ids: data.items.map((item) => item.id), status: 'ready' });
      return data;
    } catch {
      set({ status: 'error' });
      return null;
    }
  },

  /** Ids only — enough to render the hearts without fetching every card. */
  loadIds: async () => {
    try {
      const ids = await cartData.getWishlistIds();
      set({ ids });
      return ids;
    } catch {
      return [];
    }
  },

  reset: () => set({ ids: [], items: [], status: 'idle' }),

  has: (artworkId) => get().ids.includes(artworkId),

  toggle: async (artwork) => {
    const id = artwork.id ?? artwork;
    const wasSaved = get().has(id);

    // Optimistic: the heart should respond instantly.
    set((state) => ({
      ids: wasSaved ? state.ids.filter((entry) => entry !== id) : [...state.ids, id],
    }));

    try {
      const result = await cartData.toggleWishlist(id);

      set((state) => ({
        ids: result.added ? [...new Set([...state.ids, id])] : state.ids.filter((entry) => entry !== id),
      }));

      useUi.getState().toast({
        title: result.added ? 'Saved to your wishlist' : 'Removed from your wishlist',
        message: artwork.title ? `"${artwork.title}"` : '',
        tone: 'neutral',
        duration: 2500,
      });

      // Keep the full list in step when the wishlist page is open.
      if (get().status === 'ready') await get().load();
      return { ok: true, added: result.added };
    } catch (error) {
      // Roll the optimistic change back.
      set((state) => ({
        ids: wasSaved ? [...new Set([...state.ids, id])] : state.ids.filter((entry) => entry !== id),
      }));
      useUi.getState().failure('Wishlist not updated', error.message);
      return { ok: false };
    }
  },

  remove: async (artworkId) => {
    try {
      const result = await cartData.removeFromWishlist(artworkId);
      set((state) => ({
        ids: state.ids.filter((entry) => entry !== artworkId),
        items: state.items.filter((item) => item.id !== artworkId),
      }));
      return { ok: true, total: result.total };
    } catch (error) {
      useUi.getState().failure('Not removed', error.message);
      return { ok: false };
    }
  },
}));
