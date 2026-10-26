import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  FolderTree,
  LayoutDashboard,
  LineChart,
  Package,
  Palette,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import api from '../../lib/api';
import { Badge, NoticeBanner } from '../../components/ui';

const LINKS = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/artists', label: 'Artists', icon: Palette, count: 'pendingArtists' },
  { to: '/admin/moderation', label: 'Artwork Moderation', icon: ShieldCheck, count: 'pendingArtworks' },
  { to: '/admin/orders', label: 'Orders', icon: Package },
  { to: '/admin/categories', label: 'Categories', icon: FolderTree },
  { to: '/admin/reports', label: 'Reports', icon: LineChart },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export const AdminLayout = () => {
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const { data } = await api.get('/admin/overview');
      return data;
    },
    staleTime: 30_000,
  });

  const queues = overview.data?.queues ?? {};
  const integrity = overview.data?.integrity;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="mb-8 space-y-2">
        <p className="eyebrow">Administration</p>
        <h1 className="text-display-lg">Marketplace</h1>
        <p className="lede">Accounts, listings, orders and the platform&apos;s own configuration.</p>
      </header>

      {/* An admin must never read simulated figures as real revenue. */}
      {integrity?.isSimulatedGateway && (
        <NoticeBanner tone="warning" title="This server uses the simulated payment gateway" className="mb-8">
          PAYMENT_PROVIDER is set to <span className="font-mono">dev</span>. Orders are real database
          records but no money has moved, and {integrity.simulatedOrderCount}{' '}
          {integrity.simulatedOrderCount === 1 ? 'order is' : 'orders are'} flagged as simulated. Every
          figure in these reports includes them.
        </NoticeBanner>
      )}

      <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-12">
        <nav aria-label="Administration" className="mb-8 lg:mb-0">
          <ul className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:sticky lg:top-28 lg:flex-col lg:px-0">
            {LINKS.map((link) => {
              const Icon = link.icon;
              const count = link.count ? queues[link.count] : undefined;

              return (
                <li key={link.to} className="shrink-0 lg:w-full">
                  <NavLink
                    to={link.to}
                    end={link.end}
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

export default AdminLayout;
