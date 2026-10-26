import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, Heart, MapPin, MessageSquare, Package, Star, User } from 'lucide-react';
import { getAccountSummary } from '../../lib/data/orders';
import { Badge } from '../../components/ui';
import { useAuth } from '../../store/auth';

const LINKS = [
  { to: '/account/profile', label: 'My Profile', icon: User },
  { to: '/account/orders', label: 'My Orders', icon: Package, count: 'activeOrders' },
  { to: '/account/wishlist', label: 'Wishlist', icon: Heart, count: 'wishlistCount' },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin },
  { to: '/account/commissions', label: 'Commissions', icon: MessageSquare },
  { to: '/account/reviews', label: 'My Reviews', icon: Star },
  { to: '/account/notifications', label: 'Notifications', icon: Bell, count: 'unreadNotifications' },
];

export const AccountLayout = () => {
  const user = useAuth((state) => state.user);

  const summary = useQuery({
    queryKey: ['account-summary'],
    queryFn: getAccountSummary,
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="mb-10 space-y-2">
        <p className="eyebrow">Your account</p>
        <h1 className="text-display-lg">{user?.name}</h1>
        <p className="lede">{user?.email}</p>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
        {/* ── Account navigation ── */}
        <nav aria-label="Account" className="mb-8 lg:mb-0">
          {/* Horizontal on small screens, a rail on large ones. */}
          <ul className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:sticky lg:top-28 lg:flex-col lg:px-0">
            {LINKS.map((link) => {
              const Icon = link.icon;
              const count = link.count ? summary.data?.[link.count] : undefined;

              return (
                <li key={link.to} className="shrink-0 lg:w-full">
                  <NavLink
                    to={link.to}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[0.86rem] transition-colors',
                        isActive
                          ? 'bg-surface-150 text-accent-300'
                          : 'text-muted hover:bg-surface-0 hover:text-ink',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{link.label}</span>
                    {count > 0 && <Badge tone="accent">{count}</Badge>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AccountLayout;
