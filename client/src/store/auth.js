import { create } from 'zustand';
import api, { setAccessToken, setSessionLostHandler, errorMessage } from '../lib/api';

/**
 * Session state.
 *
 * The access token is kept in this store (memory) and mirrored into the axios
 * instance; it is deliberately never persisted. On a page load we ask the
 * server to refresh from the httpOnly cookie, which is what keeps someone
 * signed in across reloads without a readable token sitting in storage.
 *
 * `role` here drives which navigation is shown. It is NOT what grants access —
 * every protected action is checked again on the server.
 */
export const useAuth = create((set, get) => ({
  user: null,
  artistProfile: null,
  status: 'loading', // loading | authenticated | anonymous
  error: null,

  isAuthenticated: () => Boolean(get().user),
  hasRole: (...roles) => roles.includes(get().user?.role),

  applySession: (data) => {
    setAccessToken(data.accessToken);
    set({
      user: data.user,
      artistProfile: data.artistProfile ?? null,
      status: 'authenticated',
      error: null,
    });
  },

  clearSession: () => {
    setAccessToken(null);
    set({ user: null, artistProfile: null, status: 'anonymous', error: null });
  },

  /** Called once on boot: trades the refresh cookie for a live session. */
  restore: async () => {
    try {
      const { data } = await api.post('/auth/refresh');
      get().applySession(data);
      return data.user;
    } catch {
      // No cookie, or it expired. A normal first visit, not an error.
      set({ user: null, artistProfile: null, status: 'anonymous' });
      return null;
    }
  },

  login: async (credentials) => {
    set({ error: null });
    try {
      const { data } = await api.post('/auth/login', credentials);
      get().applySession(data);
      return { ok: true, user: data.user };
    } catch (error) {
      const message = errorMessage(error, 'We could not sign you in.');
      set({ error: message });
      return { ok: false, message };
    }
  },

  register: async (payload) => {
    set({ error: null });
    try {
      const { data } = await api.post('/auth/register', payload);
      get().applySession(data);
      return { ok: true, user: data.user };
    } catch (error) {
      const message = errorMessage(error, 'We could not create that account.');
      set({ error: message, });
      return { ok: false, message, details: error.response?.data?.error?.details ?? null };
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the call fails, drop the local session.
    }
    get().clearSession();
  },

  /** Refreshes the cached user after a profile edit. */
  refreshUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, artistProfile: data.artistProfile ?? null });
      return data.user;
    } catch {
      return null;
    }
  },

  setUser: (user) => set({ user }),
  setArtistProfile: (artistProfile) => set({ artistProfile }),
}));

// When a silent refresh fails mid-session, clear local state so the UI stops
// showing signed-in affordances the server will now reject.
setSessionLostHandler(() => {
  useAuth.getState().clearSession();
});
