import { useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { CartDrawer } from './CartDrawer';
import { SearchOverlay } from './SearchOverlay';
import { ToastStack } from '../ui';
import { useUi } from '../../store/ui';
import { useAuth } from '../../store/auth';
import { useCart, useWishlist } from '../../store/cart';

/**
 * The application shell. Everything except the immersive gallery renders
 * inside this, and the gallery opts out of the footer and page padding so it
 * can own the viewport.
 */
export const AppLayout = () => {
  const location = useLocation();
  const toasts = useUi((state) => state.toasts);
  const dismissToast = useUi((state) => state.dismissToast);
  const closeAll = useUi((state) => state.closeAll);

  const authStatus = useAuth((state) => state.status);
  const loadCart = useCart((state) => state.load);
  const loadWishlist = useWishlist((state) => state.load);
  const resetCart = useCart((state) => state.reset);
  const resetWishlist = useWishlist((state) => state.reset);

  const isGallery = location.pathname.startsWith('/gallery');

  // Cart and wishlist live on the server, so they are fetched once a session
  // exists and cleared the moment it does not.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      loadCart({ silent: true });
      loadWishlist();
    } else if (authStatus === 'anonymous') {
      resetCart();
      resetWishlist();
    }
  }, [authStatus, loadCart, loadWishlist, resetCart, resetWishlist]);

  // Route changes should never leave a drawer or overlay hanging open.
  useEffect(() => {
    closeAll();
  }, [location.pathname, closeAll]);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main
        id="main"
        className={clsx('flex-1', !isGallery && 'pt-16 sm:pt-18')}
        // The gallery manages its own scroll container and camera.
        style={isGallery ? { overflowAnchor: 'none' } : undefined}
      >
        <Outlet />
      </main>

      {!isGallery && <Footer />}

      <CartDrawer />
      <SearchOverlay />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/** Scrolls to the top on navigation, but leaves hash links alone. */
export const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);

  return null;
};

export { ScrollRestoration };
