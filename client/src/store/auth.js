import { create } from 'zustand';
import * as auth from '../lib/data/auth';
import { isSupabaseConfigured, supabaseConfigError } from '../lib/supabase';

/**
 * Session state, backed by Supabase Auth.
 *
 * Supabase owns the token: it persists and rotates the session itself, so
 * there is no refresh handling here and no token in this store. What has NOT
 * changed from the previous implementation is where the role comes from — it
 * is read from the `profiles` table, never from the JWT's metadata, because a
 * user can set their own metadata at signup.
 *
 * `role` here only decides which navigation is shown. It is not what grants
 * access: every table and function is gated by Row Level Security, so a
 * tampered client sees nothing extra.
 */
export const useAuth = create((set, get) => ({
  user: null,
  artistProfile: null,
  status: 'loading', // loading | authenticated | anonymous
  error: null,

  isAuthenticated: () => Boolean(get().user),
  hasRole: (...roles) => roles.includes(get().user?.role),

  applySession: (session) =>
    set({
      user: session?.user ?? null,
      artistProfile: session?.artistProfile ?? null,
      status: session?.user ? 'authenticated' : 'anonymous',
      error: null,
    }),

  clearSession: () => set({ user: null, artistProfile: null, status: 'anonymous', error: null }),

  /** Called once on boot, and again whenever Supabase reports a change. */
  restore: async () => {
    if (!isSupabaseConfigured) {
      set({ status: 'anonymous', error: supabaseConfigError });
      return null;
    }

    try {
      const session = await auth.getSession();
      get().applySession(session);
      return session?.user ?? null;
    } catch (error) {
      // A suspended account throws here deliberately, having been signed out.
      set({ user: null, artistProfile: null, status: 'anonymous', error: error.message });
      return null;
    }
  },

  login: async ({ email, password }) => {
    set({ error: null });
    try {
      const session = await auth.signIn({ email, password });
      get().applySession(session);
      return { ok: true, user: session.user };
    } catch (error) {
      set({ error: error.message });
      return { ok: false, message: error.message };
    }
  },

  register: async ({ name, email, password, intent, artistName }) => {
    set({ error: null });
    try {
      const result = await auth.signUp({ name, email, password, intent, artistName });

      // With email confirmation enabled there is no session yet. That is a
      // success, not a failure — the caller shows "check your email".
      if (result.needsEmailConfirmation) {
        return { ok: true, needsEmailConfirmation: true, user: null };
      }

      get().applySession(result);
      return { ok: true, user: result.user };
    } catch (error) {
      set({ error: error.message });
      return { ok: false, message: error.message };
    }
  },

  logout: async () => {
    try {
      await auth.signOut();
    } catch {
      // Drop the local session even if the network call failed.
    }
    get().clearSession();
  },

  refreshUser: async () => {
    try {
      const session = await auth.getSession();
      set({ user: session?.user ?? null, artistProfile: session?.artistProfile ?? null });
      return session?.user ?? null;
    } catch {
      return null;
    }
  },

  setUser: (user) => set({ user }),
  setArtistProfile: (artistProfile) => set({ artistProfile }),
}));

/**
 * Keeps this store in step with Supabase.
 *
 * Handles a sign-out in another tab, a token refresh, and the redirect back
 * from a password-reset link. SIGNED_IN fires on every refresh too, so the
 * handler re-reads rather than assuming it is a fresh login.
 */
if (isSupabaseConfigured) {
  auth.onAuthChange((event) => {
    const store = useAuth.getState();

    if (event === 'SIGNED_OUT') {
      store.clearSession();
      return;
    }

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      store.restore();
    }
  });
}
