import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Instagram, Globe, Mail } from 'lucide-react';
import api from '../../lib/api';

const COLUMNS = [
  {
    title: 'Collect',
    links: [
      { label: 'Explore all art', to: '/shop' },
      { label: 'Original paintings', to: '/shop?type=original' },
      { label: 'Limited prints', to: '/shop?type=print' },
      { label: 'Digital work', to: '/shop?type=digital' },
      { label: 'Available now', to: '/shop?availability=available' },
    ],
  },
  {
    title: 'Discover',
    links: [
      { label: 'The virtual gallery', to: '/gallery' },
      { label: 'Artists', to: '/artists' },
      { label: 'Photo-to-Art studio', to: '/studio' },
      { label: 'Commission a piece', to: '/studio#commission' },
    ],
  },
  {
    title: 'Sell',
    links: [
      { label: 'Become an artist', to: '/become-an-artist' },
      { label: 'Artist dashboard', to: '/artist' },
      { label: 'Sign in', to: '/login' },
    ],
  },
];

export const Footer = () => {
  // Shows what this deployment can actually do, rather than implying features
  // that are not configured.
  const { data: capabilities } = useQuery({
    queryKey: ['capabilities'],
    queryFn: async () => {
      const { data } = await api.get('/capabilities');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-line/70 bg-surface-300/60">
      <div className="mx-auto max-w-[1500px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* ── Identity ── */}
          <div className="space-y-4">
            <Link to="/" className="inline-block font-display text-2xl tracking-tight">
              Arts by <span className="text-accent-300">Jay</span>
            </Link>
            <p className="max-w-sm text-[0.86rem] leading-relaxed text-muted">
              An art marketplace and immersive virtual gallery. Original paintings, limited prints and
              digital work, sold directly by the artists who made them.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer noopener"
                className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
                aria-label="Instagram"
              >
                <Instagram className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="mailto:studio@artsbyjay.example"
                className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
                aria-label="Email the studio"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="https://artsbyjay.example"
                target="_blank"
                rel="noreferrer noopener"
                className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-accent-300/50 hover:text-accent-300"
                aria-label="Website"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* ── Link columns ── */}
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="eyebrow mb-4">{column.title}</h2>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-[0.86rem] text-muted transition-colors hover:text-accent-300"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.78rem] text-muted">© {year} Arts by Jay. All artwork belongs to its artist.</p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.75rem] text-muted">
            {capabilities?.payment && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    capabilities.payment.enabled
                      ? capabilities.payment.isSimulated
                        ? 'bg-amber-400'
                        : 'bg-accent-300'
                      : 'bg-surface-400'
                  }`}
                  aria-hidden="true"
                />
                {capabilities.payment.enabled
                  ? capabilities.payment.isSimulated
                    ? 'Simulated payments (development)'
                    : `Secure payments via ${capabilities.payment.provider}`
                  : 'Payments not yet configured'}
              </span>
            )}
            <span>Prices in {capabilities?.currency ?? 'INR'}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
