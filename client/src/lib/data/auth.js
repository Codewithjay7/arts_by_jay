import client, { supabaseError, unwrap } from '../supabase';

/**
 * Authentication against Supabase Auth.
 *
 * What changes versus the Express implementation: Supabase issues and rotates
 * the session itself, so there is no refresh-token handling here. What does
 * NOT change is where the role comes from — it is read from `profiles`, never
 * from the JWT's metadata, because a user can influence their own metadata at
 * signup and must not be able to influence their role.
 */

/** The session shape the rest of the app already expects. */
const toSession = (user, profile, artistProfile) => ({
  user: {
    id: user.id,
    name: profile?.full_name || user.email?.split('@')[0] || '',
    email: profile?.email || user.email || '',
    role: profile?.role ?? 'customer',
    avatarUrl: profile?.avatar_url ?? '',
    phone: profile?.phone ?? '',
    isActive: profile?.is_active ?? true,
    createdAt: profile?.created_at,
  },
  artistProfile: artistProfile
    ? {
        id: artistProfile.id,
        displayName: artistProfile.display_name,
        slug: artistProfile.slug,
        status: artistProfile.status,
        avatarUrl: artistProfile.avatar_url,
        reviewNote: artistProfile.review_note,
      }
    : null,
});

/**
 * Loads the profile for the signed-in user.
 *
 * The profile row is created by the `handle_new_user` trigger, but signup and
 * that trigger are not synchronous from the client's point of view, so a
 * freshly registered account can briefly have no row. This retries a couple
 * of times rather than reporting a bogus failure.
 */
const loadProfile = async (userId, { retries = 3 } = {}) => {
  const db = client();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const { data, error } = await db
      .from('profiles')
      .select('id, email, full_name, role, avatar_url, phone, is_active, suspended_reason, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw new Error(supabaseError(error, 'We could not load your profile.'));
    if (data) return data;

    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  return null;
};

/**
 * The profile row is the only source of the role and of `is_active`, so a
 * session cannot be built without it.
 *
 * `loadProfile` returning null used to flow straight into `toSession`, which
 * defaults the role to 'customer'. Two things followed: an artist or admin
 * whose profile read came back empty was quietly downgraded and sent to the
 * customer app, and — worse — the `is_active === false` check was skipped
 * entirely, so a SUSPENDED account could be signed in whenever its profile
 * row failed to load.
 *
 * Failing closed is the only safe answer. The retries above already absorb
 * the real race, which is the signup trigger not having run yet; by the time
 * this throws, something is genuinely wrong.
 */
const requireProfile = async (db, userId, context) => {
  const profile = await loadProfile(userId);

  if (!profile) {
    // Do not leave a usable token behind for an identity we cannot resolve.
    await db.auth.signOut().catch(() => {});
    const error = new Error(
      `${context} Your account exists but its profile could not be read, so we have signed you out rather than guess at your permissions. Please try again.`,
    );
    error.code = 'PROFILE_UNAVAILABLE';
    throw error;
  }

  return profile;
};

/** Signs out and throws when the account is suspended. */
const refuseIfSuspended = async (db, profile) => {
  if (profile.is_active !== false) return;

  await db.auth.signOut().catch(() => {});
  const suspended = new Error(
    profile.suspended_reason
      ? `This account is suspended: ${profile.suspended_reason}`
      : 'This account has been suspended. Please contact support.',
  );
  suspended.code = 'ACCOUNT_SUSPENDED';
  throw suspended;
};

const loadArtistProfile = async (userId) => {
  const db = client();

  const { data } = await db
    .from('artist_profiles')
    .select('id, display_name, slug, status, avatar_url, review_note')
    .eq('user_id', userId)
    .maybeSingle();

  return data ?? null;
};

/** Resolves the current session, or null. Used on boot and after auth events. */
export const getSession = async () => {
  const db = client();

  const { data } = await db.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;

  const profile = await requireProfile(db, user.id, 'We could not restore your session.');

  // A suspended account must not be treated as signed in, even though
  // Supabase still holds a valid token for it.
  await refuseIfSuspended(db, profile);

  const artistProfile =
    profile.role === 'artist' || profile.role === 'admin' ? await loadArtistProfile(user.id) : null;

  return toSession(user, profile, artistProfile);
};

export const signIn = async ({ email, password }) => {
  const db = client();

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase distinguishes these; the UI should not, so that a response
    // cannot be used to discover which emails have accounts.
    if (/invalid login credentials/i.test(error.message)) {
      throw new Error('That email and password combination is not correct.');
    }
    if (/email not confirmed/i.test(error.message)) {
      throw new Error('Please confirm your email address before signing in.');
    }
    throw new Error(supabaseError(error, 'We could not sign you in.'));
  }

  const profile = await requireProfile(db, data.user.id, 'We could not complete your sign-in.');

  await refuseIfSuspended(db, profile);

  // Advisory; a failure here must not block the sign-in.
  db.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id).then(
    () => {},
    () => {},
  );

  const artistProfile =
    profile.role === 'artist' || profile.role === 'admin' ? await loadArtistProfile(data.user.id) : null;

  return toSession(data.user, profile, artistProfile);
};

/**
 * Registers an account.
 *
 * `intent` is passed in user metadata and read by the `handle_new_user`
 * trigger, which honours only 'artist' and ignores anything else. 'admin' is
 * not self-assignable: the trigger grants it solely to an email matching the
 * server-side `admin_bootstrap_email` setting.
 */
export const signUp = async ({ name, email, password, intent = 'customer', artistName = '' }) => {
  const db = client();

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        // A request, not a grant. The database decides.
        intent: intent === 'artist' ? 'artist' : 'customer',
        artist_name: artistName,
      },
    },
  });

  if (error) {
    if (/already registered|already been registered/i.test(error.message)) {
      throw new Error('An account with that email already exists.');
    }
    if (/password/i.test(error.message)) {
      throw new Error('Use at least 10 characters, with a letter and a number.');
    }
    throw new Error(supabaseError(error, 'We could not create that account.'));
  }

  // With email confirmation enabled there is no session yet, which is a
  // success, not an error — the caller shows "check your email".
  if (!data.session) {
    return { needsEmailConfirmation: true, user: null, artistProfile: null };
  }

  // More retries than elsewhere: this is the one moment the `handle_new_user`
  // trigger may genuinely not have run yet.
  const profile = await loadProfile(data.user.id, { retries: 6 });

  /**
   * No profile row, but the account WAS created.
   *
   * Reporting a failure here would be a lie — the email is now taken, and a
   * second attempt would be refused as "already registered". Building a
   * session instead would be worse: `toSession` defaults the role to
   * 'customer', so a new artist would be sent to /artist and bounced straight
   * back out by the role guard with no explanation.
   *
   * So: say the account exists and ask them to sign in, which re-reads the
   * profile by then.
   */
  if (!profile) {
    return {
      needsEmailConfirmation: false,
      profilePending: true,
      user: null,
      artistProfile: null,
    };
  }

  const artistProfile =
    profile.role === 'artist' || profile.role === 'admin' ? await loadArtistProfile(data.user.id) : null;

  return { needsEmailConfirmation: false, ...toSession(data.user, profile, artistProfile) };
};

export const signOut = async () => {
  await client().auth.signOut();
};

export const changePassword = async ({ newPassword }) => {
  const db = client();

  // Supabase verifies the current session rather than the old password, so
  // re-authentication is the caller's job if it wants that guarantee.
  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) throw new Error(supabaseError(error, 'Your password could not be changed.'));

  return { ok: true };
};

/** Confirms the current password by attempting a sign-in with it. */
export const verifyCurrentPassword = async (email, password) => {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email, password });
  return !error;
};

export const requestPasswordReset = async (email) => {
  const db = client();

  // /reset-password, not /login. The recovery link establishes a session, and
  // /login is wrapped in RedirectIfAuthenticated — so a link pointing there
  // bounced the visitor to the home page, signed in, with no chance to set a
  // password. The flow could not be completed at all.
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  // Never reveal whether the address exists.
  if (error && !/not found/i.test(error.message)) {
    throw new Error(supabaseError(error, 'We could not send that reset email.'));
  }

  return { ok: true };
};

export const updateProfile = async ({ name, phone, avatarUrl }) => {
  const db = client();

  const { data: session } = await db.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error('Please sign in to continue.');

  // Only these three columns. The RLS policy allows an update on the caller's
  // own row, and the `profiles_guard` trigger rejects any attempt to change
  // role, is_active or suspended_reason — so passing extra fields gains
  // nothing even if a caller tried.
  //
  // `avatarUrl` used to be missing from this list while the account page
  // called updateProfile({ avatarUrl }) after uploading a picture. The patch
  // body came out empty, PostgREST matched no rows, `.single()` raised, and
  // the page reported "Upload failed" — after the file had already been
  // stored. The picture could never be saved.
  const patch = {
    ...(name !== undefined ? { full_name: name } : {}),
    ...(phone !== undefined ? { phone } : {}),
    // The column is `not null default ''`, so a cleared avatar is an empty
    // string. Sending null raises 23502.
    ...(avatarUrl !== undefined ? { avatar_url: avatarUrl ?? '' } : {}),
  };

  // An empty patch is a caller bug, not a save. PostgREST answers 200 with no
  // rows, which reads as success to everything downstream, so refuse it here
  // where the reason is still known.
  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing was supplied to update.');
  }

  const updated = unwrap(
    await db
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, email, full_name, role, avatar_url, phone, is_active, created_at')
      .single(),
    'Your profile could not be saved',
  );

  return toSession({ id: userId, email: updated.email }, updated, null).user;
};

/**
 * Subscribes to auth changes, so a sign-out in another tab, or a token
 * refresh, is reflected here.
 */
export const onAuthChange = (handler) => {
  const db = client();

  const { data } = db.auth.onAuthStateChange((event, session) => {
    handler(event, session);
  });

  return () => data?.subscription?.unsubscribe();
};
