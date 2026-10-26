import { create } from 'zustand';
import api, { errorMessage } from '../lib/api';
import { useUi } from './ui';

/**
 * Cart state.
 *
 * The cart lives on the server, so it survives a reload and follows the
 * customer between devices. This store is a cache of the server's answer —
 * every mutation round-trips and the server's re-priced response replaces
 * local state wholesale. Nothing here computes a total.
 */
export const useCart = create((set, get) => ({
  items: [],
  totals: { subtotalMinor: 0, shippingTotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: 'INR', itemCount: 0 },
  issues: [],
  shippingMethods: [],
  shippingMethod: 'standard',
  status: 'idle', // idle | loading | ready | error
  error: null,
  pendingIds: [],

  /** True while a specific artwork has a mutation in flight. */
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
      totals: data.totals ?? get().totals,
      issues: data.issues ?? [],
      shippingMethods: data.shippingMethods ?? get().shippingMethods,
      shippingMethod: data.shippingMethod ?? get().shippingMethod,
      status: 'ready',
      error: null,
    }),

  reset: () =>
    set({
      items: [],
      totals: { subtotalMinor: 0, shippingTotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: 'INR', itemCount: 0 },
      issues: [],
      status: 'idle',
      error: null,
    }),

  load: async ({ silent = false } = {}) => {
    if (!silent) set({ status: 'loading' });
    try {
      const { data } = await api.get('/cart');
      get().apply(data);

      // The server adjusts quantities when stock moved; say so rather than
      // letting the number change under the customer silently.
      (data.issues ?? [])
        .filter((issue) => issue.kind === 'quantity_reduced' || issue.kind === 'sold_out')
        .forEach((issue) => useUi.getState().info('Your cart changed', issue.message));

      return data;
    } catch (error) {
      set({ status: 'error', error: errorMessage(error) });
      return null;
    }
  },

  add: async (artwork, quantity = 1) => {
    const id = artwork.id ?? artwork;
    get().markPending(id, true);

    try {
      const { data } = await api.post('/cart/items', { artworkId: id, quantity });
      get().apply(data);
      useUi.getState().success('Added to your cart', artwork.title ? `"${artwork.title}"` : '');
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error, 'That could not be added to your cart.');
      useUi.getState().failure('Not added', message);
      return { ok: false, message };
    } finally {
      get().markPending(id, false);
    }
  },

  setQuantity: async (artworkId, quantity) => {
    get().markPending(artworkId, true);
    try {
      const { data } = await api.patch(`/cart/items/${artworkId}`, { quantity });
      get().apply(data);
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error, 'That quantity could not be set.');
      useUi.getState().failure('Not updated', message);
      // Re-sync so the UI shows what the server actually holds.
      await get().load({ silent: true });
      return { ok: false, message };
    } finally {
      get().markPending(artworkId, false);
    }
  },

  remove: async (artworkId) => {
    get().markPending(artworkId, true);
    try {
      const { data } = await api.delete(`/cart/items/${artworkId}`);
      get().apply(data);
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Not removed', errorMessage(error));
      return { ok: false };
    } finally {
      get().markPending(artworkId, false);
    }
  },

  clear: async () => {
    try {
      const { data } = await api.delete('/cart');
      get().apply(data);
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Could not empty your cart', errorMessage(error));
      return { ok: false };
    }
  },

  setShippingMethod: async (method) => {
    set({ shippingMethod: method });
    try {
      const { data } = await api.get('/cart', { params: { shippingMethod: method } });
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
      const { data } = await api.get('/wishlist');
      set({ items: data.items ?? [], ids: (data.items ?? []).map((item) => item.id), status: 'ready' });
      return data;
    } catch {
      set({ status: 'error' });
      return null;
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
      const { data } = await api.post('/wishlist', { artworkId: id });
      set((state) => ({
        ids: data.added ? [...new Set([...state.ids, id])] : state.ids.filter((entry) => entry !== id),
      }));

      useUi.getState().toast({
        title: data.added ? 'Saved to your wishlist' : 'Removed from your wishlist',
        message: artwork.title ? `"${artwork.title}"` : '',
        tone: 'neutral',
        duration: 2500,
      });

      // Keep the full list in step when the wishlist page is open.
      if (get().status === 'ready') await get().load();
      return { ok: true, added: data.added };
    } catch (error) {
      // Roll the optimistic change back.
      set((state) => ({
        ids: wasSaved ? [...new Set([...state.ids, id])] : state.ids.filter((entry) => entry !== id),
      }));
      useUi.getState().failure('Wishlist not updated', errorMessage(error));
      return { ok: false };
    }
  },

  remove: async (artworkId) => {
    try {
      await api.delete(`/wishlist/${artworkId}`);
      set((state) => ({
        ids: state.ids.filter((entry) => entry !== artworkId),
        items: state.items.filter((item) => item.id !== artworkId),
      }));
      return { ok: true };
    } catch (error) {
      useUi.getState().failure('Not removed', errorMessage(error));
      return { ok: false };
    }
  },
}));
