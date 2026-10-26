import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Banknote,
  FolderTree,
  LayoutDashboard,
  Link2,
  LineChart,
  MessageSquare,
  Package,
  Palette,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Star,
  Users,
} from 'lucide-react';
import { getOverview } from '../../lib/data/admin';
import { Badge, NoticeBanner } from '../../components/ui';

/**
 * Grouped so the dashboard reads as four concerns rather than one long list:
 * what needs a decision, who is on the platform, where the money is, and the
 * record of what was done.
 */
const GROUPS = [
  {
    title: null,
    links: [{ to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Curation',
    links: [
      { to: '/admin/moderation', label: 'Artwork', icon: ShieldCheck, count: 'pendingArtworks' },
      { to: '/admin/artists', label: 'Artist applications', icon: Palette, count: 'pendingArtists' },
      { to: '/admin/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/categories', label: 'Categories', icon: FolderTree },
    ],
  },
  {
    title: 'Trade',
    links: [
      { to: '/admin/orders', label: 'Orders', icon: Package },
      { to: '/admin/payouts', label: 'Artist payouts', icon: Banknote },
      { to: '/admin/reconciliation', label: 'Reconciliation', icon: Scale },
      { to: '/admin/linked-accounts', label: 'Linked accounts', icon: Link2 },
      { to: '/admin/reports', label: 'Reports', icon: LineChart },
    ],
  },
  {
    title: 'People and record',
    links: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/enquiries', label: 'Enquiries', icon: MessageSquare, count: 'openEnquiries' },
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
      { to: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const AdminLayout = () => {
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: getOverview,
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

      {/* The single fact that changes how every money figure here should be
          read: without Route, nothing has been transferred to an artist. */}
      {integrity && integrity.routeEnabled === false && (
        <NoticeBanner tone="warning" title="Razorpay Route is not enabled" className="mb-8">
          Customer payments settle into your own Razorpay account, so artist earnings shown anywhere in
          this dashboard are an accounting ledger rather than completed transfers. Record each payout on
          the{' '}
          <Link to="/admin/payouts" className="underline">
            Artist payouts
          </Link>{' '}
          screen once you have made the bank transfer.
        </NoticeBanner>
      )}

      <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-12">
        <nav aria-label="Administration" className="mb-8 lg:mb-0">
          <div className="lg:sticky lg:top-20 lg:space-y-6">
            {GROUPS.map((group, index) => (
              <div key={group.title ?? index}>
                {group.title && (
                  <p className="mb-2 hidden px-3.5 text-[0.72rem] font-medium uppercase tracking-wide text-muted lg:block">
                    {group.title}
                  </p>
                )}
                <ul className="no-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:flex-col lg:px-0">
                  {group.links.map((link) => {
                    const Icon = link.icon;
                    const count = link.count ? queues[link.count] : undefined;

                    return (
                      <li key={link.to} className="shrink-0 lg:w-full">
                        <NavLink
                          to={link.to}
                          end={link.end}
                          className={({ isActive }) =>
                            clsx(
                              'flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-[0.875rem] transition-colors',
                              isActive
                                ? 'bg-surface-0 font-medium text-ink shadow-card'
                                : 'text-muted hover:bg-surface-150 hover:text-ink',
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
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AdminLayout;
