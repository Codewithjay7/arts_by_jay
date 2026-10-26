import { create } from 'zustand';

let toastId = 0;

/** Transient UI: toasts, the cart drawer, the search overlay. */
export const useUi = create((set, get) => ({
  toasts: [],
  isCartOpen: false,
  isSearchOpen: false,
  isMobileNavOpen: false,

  toast: ({ title, message = '', tone = 'neutral', duration = 4500 }) => {
    toastId += 1;
    const id = toastId;

    set((state) => ({ toasts: [...state.toasts, { id, title, message, tone }] }));

    if (duration > 0) {
      setTimeout(() => get().dismissToast(id), duration);
    }
    return id;
  },

  success: (title, message) => get().toast({ title, message, tone: 'positive' }),
  failure: (title, message) => get().toast({ title, message, tone: 'negative', duration: 7000 }),
  info: (title, message) => get().toast({ title, message, tone: 'info' }),

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),

  openCart: () => set({ isCartOpen: true, isSearchOpen: false, isMobileNavOpen: false }),
  closeCart: () => set({ isCartOpen: false }),
  toggleCart: () => set((state) => ({ isCartOpen: !state.isCartOpen })),

  openSearch: () => set({ isSearchOpen: true, isCartOpen: false, isMobileNavOpen: false }),
  closeSearch: () => set({ isSearchOpen: false }),

  openMobileNav: () => set({ isMobileNavOpen: true, isCartOpen: false }),
  closeMobileNav: () => set({ isMobileNavOpen: false }),

  closeAll: () => set({ isCartOpen: false, isSearchOpen: false, isMobileNavOpen: false }),
}));
