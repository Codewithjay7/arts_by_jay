import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Bell,
  ChevronDown,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Palette,
  Search,
  Shield,
  ShoppingBag,
  User,
  X,
} from 'lucide-react';
import { Badge, Button } from '../ui';
import { useAuth } from '../../store/auth';
import { useCart, useWishlist } from '../../store/cart';
import { useUi } from '../../store/ui';

/** Public navigation, identical for everyone. */
const PUBLIC_LINKS = [
  { to: '/shop', label: 'Explore Art' },
  { to: '/gallery', label: 'Virtual Gallery' },
  { to: '/artists', label: 'Artists' },
  { to: '/studio', label: 'Custom Art' },
];

export const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuth((state) => state.user);
  const artistProfile = useAuth((state) => state.artistProfile);
  const logout = useAuth((state) => state.logout);

  const cartCount = useCart((state) => state.totals.itemCount);
  const wishlistCount = useWishlist((state) => state.ids.length);

  const { openCart, openSearch, isMobileNavOpen, openMobileNav, closeMobileNav } = useUi();

  const [isScrolled, setIsScrolled] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  // The gallery owns the full viewport, so the bar sits over it transparently.
  const isGallery = location.pathname.startsWith('/gallery');

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the menus on navigation, so they never linger over a new page.
  useEffect(() => {
    setAccountOpen(false);
    closeMobileNav();
  }, [location.pathname, closeMobileNav]);

  useEffect(() => {
    if (!accountOpen) return undefined;

    const onPointerDown = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const onKeyDown = (event) => event.key === 'Escape' && setAccountOpen(false);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);

  const onLogout = async () => {
    await logout();
    useCart.getState().reset();
    useWishlist.getState().reset();
    navigate('/');
  };

  const linkClass = ({ isActive }) =>
    clsx(
      'relative px-1 py-2 text-[0.84rem] tracking-wide transition-colors',
      'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-accent-300 after:transition-transform after:duration-300',
      'hover:after:scale-x-100',
      isActive ? 'text-accent-300 after:scale-x-100' : 'text-parchment/85 hover:text-parchment',
    );

  return (
    <>
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-[70] rounded-full bg-accent-300 px-4 py-2 text-sm font-medium text-ink"
      >
        Skip to content
      </a>

      <header
        className={clsx(
          'fixed inset-x-0 top-0 z-40 transition-all duration-500 ease-gallery',
          isScrolled || isMobileNavOpen
            ? 'border-b border-charcoal-700/80 bg-charcoal-950/88 backdrop-blur-xl'
            : isGallery
              ? 'bg-gradient-to-b from-charcoal-950/70 to-transparent'
              : 'bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-6 px-4 sm:h-18 sm:px-6 lg:px-10">
          {/* ── Wordmark ── */}
          <Link to="/" className="group flex shrink-0 items-baseline gap-2" aria-label="Arts by Jay, home">
            <span className="font-display text-xl tracking-tight text-parchment sm:text-2xl">
              Arts by <span className="text-accent-300">Jay</span>
            </span>
          </Link>

          {/* ── Desktop navigation ── */}
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
            {PUBLIC_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass}>
                {link.label}
              </NavLink>
            ))}

            {/* Only shown to someone who is not already selling. */}
            {(!user || user.role === 'customer') && (
              <NavLink to="/become-an-artist" className={linkClass}>
                Become an Artist
              </NavLink>
            )}
          </nav>

          {/* ── Actions ── */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={openSearch}
              className="grid h-10 w-10 place-items-center rounded-full text-parchment/85 transition-colors hover:bg-charcoal-800 hover:text-accent-300"
              aria-label="Search artwork"
            >
              <Search className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
            </button>

            {user && (
              <Link
                to="/account/wishlist"
                className="relative hidden h-10 w-10 place-items-center rounded-full text-parchment/85 transition-colors hover:bg-charcoal-800 hover:text-accent-300 sm:grid"
                aria-label={`Wishlist, ${wishlistCount} ${wishlistCount === 1 ? 'item' : 'items'}`}
              >
                <Heart className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
                {wishlistCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-300 px-1 font-mono text-[0.6rem] font-semibold text-ink">
                    {wishlistCount > 9 ? '9+' : wishlistCount}
                  </span>
                )}
              </Link>
            )}

            <button
              type="button"
              onClick={openCart}
              className="relative grid h-10 w-10 place-items-center rounded-full text-parchment/85 transition-colors hover:bg-charcoal-800 hover:text-accent-300"
              aria-label={`Shopping cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            >
              <ShoppingBag className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-300 px-1 font-mono text-[0.6rem] font-semibold text-ink">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </button>

            {/* ── Account menu, role-aware ── */}
            {user ? (
              <div ref={accountRef} className="relative ml-1 hidden lg:block">
                <button
                  type="button"
                  onClick={() => setAccountOpen((open) => !open)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-full border border-charcoal-600 bg-charcoal-850/70 py-1 pl-1 pr-3 transition-colors hover:border-charcoal-500"
                >
                  <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-accent-300 font-medium text-ink">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[0.72rem]">{user.name.charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="max-w-[7rem] truncate text-[0.8rem] text-parchment">
                    {user.name.split(' ')[0]}
                  </span>
                  <ChevronDown
                    className={clsx('h-3.5 w-3.5 text-muted transition-transform', accountOpen && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-2 w-60 animate-fade-up overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-850 shadow-frame"
                  >
                    <div className="border-b border-charcoal-700 px-4 py-3">
                      <p className="truncate text-sm text-parchment">{user.name}</p>
                      <p className="truncate text-[0.75rem] text-muted">{user.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>
                        {artistProfile && artistProfile.status !== 'approved' && (
                          <Badge tone="warning">{artistProfile.status}</Badge>
                        )}
                      </div>
                    </div>

                    <div className="py-1.5">
                      <MenuItem to="/account/profile" icon={User} label="My Profile" />
                      <MenuItem to="/account/orders" icon={Package} label="My Orders" />
                      <MenuItem to="/account/wishlist" icon={Heart} label="Wishlist" />
                      <MenuItem to="/account/notifications" icon={Bell} label="Notifications" />
                    </div>

                    {/* Dashboards only appear for roles that actually have them. */}
                    {(user.role === 'artist' || user.role === 'admin') && (
                      <div className="border-t border-charcoal-700 py-1.5">
                        <MenuItem to="/artist" icon={Palette} label="Artist Dashboard" />
                      </div>
                    )}

                    {user.role === 'admin' && (
                      <div className="border-t border-charcoal-700 py-1.5">
                        <MenuItem to="/admin" icon={Shield} label="Admin Dashboard" />
                      </div>
                    )}

                    <div className="border-t border-charcoal-700 py-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={onLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[0.84rem] text-parchment/85 transition-colors hover:bg-charcoal-800 hover:text-red-300"
                      >
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="ml-1.5 hidden items-center gap-2 lg:flex">
                <Button variant="ghost" size="sm" to="/login">
                  Sign in
                </Button>
                <Button variant="primary" size="sm" to="/register">
                  Create account
                </Button>
              </div>
            )}

            <button
              type="button"
              onClick={() => (isMobileNavOpen ? closeMobileNav() : openMobileNav())}
              className="grid h-10 w-10 place-items-center rounded-full text-parchment transition-colors hover:bg-charcoal-800 lg:hidden"
              aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileNavOpen}
            >
              {isMobileNavOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* ── Mobile drawer ── */}
        {isMobileNavOpen && (
          <div className="max-h-[calc(100vh-4rem)] animate-fade-up overflow-y-auto border-t border-charcoal-700 bg-charcoal-950/97 px-4 pb-8 pt-4 backdrop-blur-xl lg:hidden">
            <nav className="space-y-0.5" aria-label="Mobile">
              {PUBLIC_LINKS.map((link) => (
                <MobileLink key={link.to} to={link.to} label={link.label} />
              ))}
              {(!user || user.role === 'customer') && (
                <MobileLink to="/become-an-artist" label="Become an Artist" />
              )}
            </nav>

            <div className="mt-6 border-t border-charcoal-700 pt-5">
              {user ? (
                <>
                  <p className="px-3 pb-3 text-[0.75rem] text-muted">
                    Signed in as <span className="text-parchment">{user.email}</span>
                  </p>
                  <nav className="space-y-0.5">
                    <MobileLink to="/account/profile" label="My Profile" icon={User} />
                    <MobileLink to="/account/orders" label="My Orders" icon={Package} />
                    <MobileLink to="/account/wishlist" label="Wishlist" icon={Heart} />
                    {(user.role === 'artist' || user.role === 'admin') && (
                      <MobileLink to="/artist" label="Artist Dashboard" icon={LayoutDashboard} />
                    )}
                    {user.role === 'admin' && <MobileLink to="/admin" label="Admin Dashboard" icon={Shield} />}
                  </nav>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="mt-3 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[0.9rem] text-red-300 transition-colors hover:bg-charcoal-850"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Log out
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <Button variant="primary" to="/register" className="w-full">
                    Create an account
                  </Button>
                  <Button variant="secondary" to="/login" className="w-full">
                    Sign in
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
};

const MenuItem = ({ to, icon: Icon, label }) => (
  <Link
    to={to}
    role="menuitem"
    className="flex items-center gap-2.5 px-4 py-2 text-[0.84rem] text-parchment/85 transition-colors hover:bg-charcoal-800 hover:text-accent-300"
  >
    <Icon className="h-4 w-4" aria-hidden="true" />
    {label}
  </Link>
);

const MobileLink = ({ to, label, icon: Icon }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      clsx(
        'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.95rem] transition-colors',
        isActive ? 'bg-charcoal-850 text-accent-300' : 'text-parchment/90 hover:bg-charcoal-850',
      )
    }
  >
    {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
    {label}
  </NavLink>
);
