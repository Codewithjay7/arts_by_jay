import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Frame,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  Package,
  Plus,
  Settings,
} from 'lucide-react';
import api from '../../lib/api';
import { Badge, Button, NoticeBanner } from '../../components/ui';
import { useAuth } from '../../store/auth';

const LINKS = [
  { to: '/artist', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/artist/artworks', label: 'My Artwork', icon: Frame },
  { to: '/artist/artworks/new', label: 'Add Artwork', icon: Plus },
  { to: '/artist/orders', label: 'Orders', icon: Package, count: 'ordersToFulfil' },
  { to: '/artist/sales', label: 'Sales', icon: LineChart },
  { to: '/artist/enquiries', label: 'Enquiries', icon: MessageSquare, count: 'openEnquiries' },
  { to: '/artist/storefront', label: 'Storefront Settings', icon: Settings },
];

export const ArtistLayout = () => {
  const artistProfile = useAuth((state) => state.artistProfile);

  const overview = useQuery({
    queryKey: ['artist-overview'],
    queryFn: async () => {
      const { data } = await api.get('/artist/overview');
      return data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const profile = overview.data?.profile ?? artistProfile;
  const needsAttention = overview.data?.actionsNeeded ?? {};

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div className="space-y-2">
          <p className="eyebrow">Artist dashboard</p>
          <h1 className="text-display-lg">{profile?.displayName ?? 'Your studio'}</h1>
          {profile?.status && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  profile.status === 'approved'
                    ? 'positive'
                    : profile.status === 'pending'
                      ? 'warning'
                      : 'negative'
                }
              >
                {profile.status === 'approved' ? 'Approved to sell' : profile.status}
              </Badge>
              {profile.slug && profile.status === 'approved' && (
                <a
                  href={`/artists/${profile.slug}`}
                  className="text-[0.78rem] text-muted underline-offset-4 transition-colors hover:text-lime-300 hover:underline"
                >
                  View my public storefront
                </a>
              )}
            </div>
          )}
        </div>

        <Button variant="primary" to="/artist/artworks/new">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add artwork
        </Button>
      </header>

      {/* The one thing an unapproved artist most needs to know. */}
      {profile?.status === 'pending' && (
        <NoticeBanner tone="warning" title="Your account is still under review" className="mb-8">
          You can build your profile and prepare drafts now. Publishing is unlocked once a curator approves
          your account.
          {profile.reviewNote ? ` Curator note: ${profile.reviewNote}` : ''}
        </NoticeBanner>
      )}

      {profile?.status === 'rejected' && (
        <NoticeBanner tone="warning" title="Your application was not approved" className="mb-8">
          {profile.reviewNote || 'Please contact us if you would like to discuss it.'}
        </NoticeBanner>
      )}

      {profile?.status === 'suspended' && (
        <NoticeBanner tone="warning" title="Your artist account is suspended" className="mb-8">
          {profile.reviewNote || 'Your listings have been taken off the marketplace. Please contact support.'}
        </NoticeBanner>
      )}

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
        <nav aria-label="Artist dashboard" className="mb-8 lg:mb-0">
          <ul className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:sticky lg:top-28 lg:flex-col lg:px-0">
            {LINKS.map((link) => {
              const Icon = link.icon;
              const count = link.count ? needsAttention[link.count] : undefined;

              return (
                <li key={link.to} className="shrink-0 lg:w-full">
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[0.86rem] transition-colors',
                        isActive
                          ? 'bg-charcoal-800 text-lime-300'
                          : 'text-muted hover:bg-charcoal-850 hover:text-parchment',
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

export default ArtistLayout;
