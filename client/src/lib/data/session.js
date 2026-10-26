import client from '../supabase';

/**
 * Who is asking.
 *
 * Row Level Security is and remains the security boundary — these helpers add
 * nothing to it and are not a substitute for it. What they add is honesty.
 *
 * Every admin read was written to lean entirely on RLS, on the reasoning that
 * a non-admin "simply sees nothing rather than being refused". That is true of
 * the rows, and it is why nothing leaks. But it means a non-admin calling
 * `getOverview()` receives a complete, well-formed platform dashboard in which
 * every private figure is zero: 0 users, 0 orders, no revenue. Verified
 * against the live project — an anonymous caller gets exactly that.
 *
 * Zero is not the same as "not allowed to know", and a page cannot tell the
 * difference. If a route guard ever regresses, or a function is called from
 * somewhere new, the result is a dashboard confidently reporting a platform
 * with no users and no money. Refusing is the only answer that cannot be
 * misread.
 *
 * The role is read from `profiles`, never from the JWT, for the same reason it
 * is everywhere else in this codebase: a user can influence their own token
 * metadata and must not be able to influence their role.
 */

/** The signed-in user's id, or null. */
export const currentUserId = async () => {
  const { data } = await client().auth.getSession();
  return data?.session?.user?.id ?? null;
};

/** Throws unless someone is signed in. Returns their id. */
export const requireSession = async (
  message = 'Please sign in to continue.',
) => {
  const userId = await currentUserId();
  if (!userId) {
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
  return userId;
};

/**
 * Throws unless the caller is an administrator. Returns their id.
 *
 * One extra round trip per admin page load, which is a fair price for a
 * screen of financial figures never being able to render as a convincing row
 * of zeros to someone who should not see it.
 */
export const requireAdmin = async () => {
  const userId = await requireSession('Please sign in as an administrator.');

  const { data, error } = await client()
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error || data?.role !== 'admin') {
    const refusal = new Error('This area is only available to administrators.');
    refusal.status = 403;
    throw refusal;
  }

  return userId;
};

/** Throws unless the caller is an artist or an administrator. */
export const requireArtist = async () => {
  const userId = await requireSession('Please sign in to continue.');

  const { data, error } = await client()
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error || !['artist', 'admin'].includes(data?.role)) {
    const refusal = new Error('Artist tools are only available to artist accounts.');
    refusal.status = 403;
    throw refusal;
  }

  return userId;
};
