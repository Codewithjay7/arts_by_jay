import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout, ScrollToTop } from './components/layout/AppLayout';
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from './components/guards';
import { LoadingBlock } from './components/ui';
import { useAuth } from './store/auth';
import { useUi } from './store/ui';

/* ── Eager: the pages a first visit is most likely to need ── */
import HomePage from './pages/HomePage';
import ShopPage from './pages/ShopPage';
import ArtworkDetailPage from './pages/ArtworkDetailPage';
import NotFoundPage from './pages/NotFoundPage';

/* ── Lazy: everything behind a click, so the first load stays small ── */
const GalleryPage = lazy(() => import('./pages/GalleryPage'));
const ArtistsPage = lazy(() => import('./pages/ArtistsPage').then((m) => ({ default: m.ArtistsPage })));
const ArtistStorefrontPage = lazy(() =>
  import('./pages/ArtistsPage').then((m) => ({ default: m.ArtistStorefrontPage })),
);
const StudioPage = lazy(() => import('./pages/StudioPage'));
const BecomeArtistPage = lazy(() => import('./pages/BecomeArtistPage'));
const CartPage = lazy(() => import('./pages/CartPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const OrderConfirmationPage = lazy(() => import('./pages/OrderConfirmationPage'));

const LoginPage = lazy(() => import('./pages/auth/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/auth/AuthPages').then((m) => ({ default: m.RegisterPage })));

const AccountLayout = lazy(() => import('./pages/account/AccountLayout'));
const AccountPages = {
  Profile: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.ProfilePage }))),
  Orders: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.OrdersPage }))),
  OrderDetail: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.OrderDetailPage }))),
  Wishlist: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.WishlistPage }))),
  Addresses: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.AddressesPage }))),
  Commissions: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.MyCommissionsPage }))),
  Reviews: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.MyReviewsPage }))),
  Notifications: lazy(() => import('./pages/account/AccountPages').then((m) => ({ default: m.NotificationsPage }))),
};

const ArtistLayout = lazy(() => import('./pages/artist/ArtistLayout'));
const ArtistPages = {
  Overview: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistOverviewPage }))),
  Artworks: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistArtworksPage }))),
  ArtworkForm: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtworkFormPage }))),
  Orders: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistOrdersPage }))),
  Sales: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistSalesPage }))),
  Enquiries: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistEnquiriesPage }))),
  Storefront: lazy(() => import('./pages/artist/ArtistPages').then((m) => ({ default: m.ArtistStorefrontPage }))),
};

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminPages = {
  Overview: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminOverviewPage }))),
  Users: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminUsersPage }))),
  Artists: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminArtistsPage }))),
  Moderation: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminModerationPage }))),
  Orders: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminOrdersPage }))),
  Categories: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminCategoriesPage }))),
  Reports: lazy(() => import('./pages/admin/AdminPages').then((m) => ({ default: m.AdminReportsPage }))),
  // The expanded surfaces live in their own modules so the main admin chunk
  // does not grow for every admin who never opens them.
  Payouts: lazy(() => import('./pages/admin/AdminPayouts')),
  Reconciliation: lazy(() =>
    import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminReconciliationPage })),
  ),
  Audit: lazy(() => import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminAuditPage }))),
  Reviews: lazy(() => import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminReviewsPage }))),
  Enquiries: lazy(() =>
    import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminEnquiriesPage })),
  ),
  LinkedAccounts: lazy(() =>
    import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminLinkedAccountsPage })),
  ),
  // The editable version supersedes the read-only one in AdminPages.
  Settings: lazy(() => import('./pages/admin/AdminOversight').then((m) => ({ default: m.AdminSettingsPage }))),
};

const PageFallback = () => <LoadingBlock className="min-h-[60vh]" />;

export const App = () => {
  const restore = useAuth((state) => state.restore);
  const openSearch = useUi((state) => state.openSearch);

  // One silent refresh on boot, so a returning visitor is signed in without
  // a readable token ever having been stored.
  useEffect(() => {
    restore();
  }, [restore]);

  // "/" focuses search, the convention on content-heavy sites.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === '/' && !isTyping && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openSearch();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openSearch]);

  return (
    <>
      <ScrollToTop />

      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            {/* ── Public storefront ── */}
            <Route index element={<HomePage />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="art/:slug" element={<ArtworkDetailPage />} />
            <Route path="gallery" element={<GalleryPage />} />
            <Route path="artists" element={<ArtistsPage />} />
            <Route path="artists/:slug" element={<ArtistStorefrontPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="become-an-artist" element={<BecomeArtistPage />} />

            {/* ── Purchase flow ── */}
            <Route path="cart" element={<CartPage />} />
            <Route element={<RequireAuth />}>
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="order-confirmation/:orderNumber" element={<OrderConfirmationPage />} />
            </Route>

            {/* ── Customer account ── */}
            <Route element={<RequireAuth />}>
              <Route path="account" element={<AccountLayout />}>
                <Route index element={<Navigate to="/account/profile" replace />} />
                <Route path="profile" element={<AccountPages.Profile />} />
                <Route path="orders" element={<AccountPages.Orders />} />
                <Route path="orders/:orderNumber" element={<AccountPages.OrderDetail />} />
                <Route path="wishlist" element={<AccountPages.Wishlist />} />
                <Route path="addresses" element={<AccountPages.Addresses />} />
                <Route path="commissions" element={<AccountPages.Commissions />} />
                <Route path="reviews" element={<AccountPages.Reviews />} />
                <Route path="notifications" element={<AccountPages.Notifications />} />
              </Route>
            </Route>

            {/* ── Artist dashboard ──
                 Role-gated in the browser for the artist's benefit; every
                 endpoint behind it re-checks the role on the server. */}
            <Route
              path="artist"
              element={
                <RequireRole roles={['artist', 'admin']}>
                  <ArtistLayout />
                </RequireRole>
              }
            >
              <Route index element={<ArtistPages.Overview />} />
              <Route path="artworks" element={<ArtistPages.Artworks />} />
              <Route path="artworks/new" element={<ArtistPages.ArtworkForm />} />
              <Route path="artworks/:id" element={<ArtistPages.ArtworkForm />} />
              <Route path="orders" element={<ArtistPages.Orders />} />
              <Route path="sales" element={<ArtistPages.Sales />} />
              <Route path="enquiries" element={<ArtistPages.Enquiries />} />
              <Route path="storefront" element={<ArtistPages.Storefront />} />
            </Route>

            {/* ── Administration ── */}
            <Route
              path="admin"
              element={
                <RequireRole roles={['admin']}>
                  <AdminLayout />
                </RequireRole>
              }
            >
              <Route index element={<AdminPages.Overview />} />
              <Route path="users" element={<AdminPages.Users />} />
              <Route path="artists" element={<AdminPages.Artists />} />
              <Route path="moderation" element={<AdminPages.Moderation />} />
              <Route path="orders" element={<AdminPages.Orders />} />
              <Route path="categories" element={<AdminPages.Categories />} />
              <Route path="reports" element={<AdminPages.Reports />} />
              <Route path="payouts" element={<AdminPages.Payouts />} />
              <Route path="reconciliation" element={<AdminPages.Reconciliation />} />
              <Route path="linked-accounts" element={<AdminPages.LinkedAccounts />} />
              <Route path="reviews" element={<AdminPages.Reviews />} />
              <Route path="enquiries" element={<AdminPages.Enquiries />} />
              <Route path="audit" element={<AdminPages.Audit />} />
              <Route path="settings" element={<AdminPages.Settings />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* ── Auth, outside the shell so they can own the viewport ── */}
          <Route
            path="/login"
            element={
              <RedirectIfAuthenticated>
                <LoginPage />
              </RedirectIfAuthenticated>
            }
          />
          <Route
            path="/register"
            element={
              <RedirectIfAuthenticated>
                <RegisterPage />
              </RedirectIfAuthenticated>
            }
          />
        </Routes>
      </Suspense>
    </>
  );
};

export default App;
