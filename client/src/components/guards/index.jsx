import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { Button, EmptyState, LoadingBlock } from '../ui';

/**
 * Route guards.
 *
 * These exist for the customer's benefit — so they are not shown a dashboard
 * they cannot use. They are NOT the security boundary: every protected
 * endpoint re-checks the role on the server, so bypassing these in the browser
 * gains nothing.
 */

export const RequireAuth = () => {
  const status = useAuth((state) => state.status);
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock label="Checking your session" className="min-h-[60vh]" />;

  if (status !== 'authenticated') {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <Outlet />;
};

export const RequireRole = ({ roles, children }) => {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock label="Checking your access" className="min-h-[60vh]" />;

  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (!roles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <EmptyState
          icon={ShieldAlert}
          title="This area is not available to your account"
          message={
            roles.includes('artist')
              ? 'Artist tools are available once you have an artist account. You can apply in a minute.'
              : 'You do not have permission to view this part of the marketplace.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {roles.includes('artist') && user.role === 'customer' && (
                <Button variant="primary" to="/become-an-artist">
                  Become an artist
                </Button>
              )}
              <Button variant="secondary" to="/">
                Back to the marketplace
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return children ?? <Outlet />;
};

/** Keeps a signed-in visitor off the sign-in and registration pages. */
export const RedirectIfAuthenticated = ({ children }) => {
  const status = useAuth((state) => state.status);
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock className="min-h-[60vh]" />;

  if (status === 'authenticated') {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  return children;
};
