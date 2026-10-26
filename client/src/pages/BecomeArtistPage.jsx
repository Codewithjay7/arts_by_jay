import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Frame, LineChart, Palette, Upload } from 'lucide-react';
import api, { errorDetails, errorMessage } from '../lib/api';
import {
  Button,
  Field,
  Input,
  NoticeBanner,
  SectionHeader,
  StatCard,
  Textarea,
} from '../components/ui';
import { Reveal } from '../components/motion/Reveal';
import { useDocumentTitle } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

const BENEFITS = [
  {
    icon: Frame,
    title: 'Your own storefront',
    body: 'A public page with your biography, statement and every piece you list, at your own URL.',
  },
  {
    icon: Palette,
    title: 'Hung in the virtual gallery',
    body: 'Your published work appears on the gallery walls alongside everyone else, with no extra effort.',
  },
  {
    icon: LineChart,
    title: 'Your numbers, plainly',
    body: 'Orders, earnings and what the platform retains, visible in your dashboard from the first sale.',
  },
  {
    icon: Upload,
    title: 'You set the terms',
    body: 'Your prices, your editions, your shipping. Save drafts and publish when a piece is ready.',
  },
];

const STEPS = [
  'Create an artist account, or apply from the account you already have.',
  'Set up your profile: name, biography, statement and a portrait.',
  'Upload your first pieces as drafts, with prices, sizes and mediums.',
  'A curator reviews your application, usually within a few days.',
  'Once approved, publish your work and it goes live across the marketplace.',
];

export const BecomeArtistPage = () => {
  useDocumentTitle('Become an Artist');

  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const artistProfile = useAuth((state) => state.artistProfile);
  const refreshUser = useAuth((state) => state.refreshUser);
  const success = useUi((state) => state.success);

  const [form, setForm] = useState({ displayName: user?.name ?? '', bio: '', location: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const config = useQuery({
    queryKey: ['checkout-config'],
    queryFn: async () => {
      const { data } = await api.get('/checkout/config');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const commissionPercent = config.data?.commissionPercent;

  /** An existing customer applying to sell. */
  const apply = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post('/artist/profile', form);
      await refreshUser();
      success('Your application is in', 'Set up your storefront while a curator reviews it.');
      navigate('/artist/storefront');
    } catch (requestError) {
      setError(errorMessage(requestError, 'That application could not be sent.'));
      setFieldErrors(errorDetails(requestError) ?? {});
    } finally {
      setSubmitting(false);
    }
  };

  const alreadyArtist = user && (user.role === 'artist' || user.role === 'admin') && artistProfile;

  return (
    <div>
      {/* ── Hero ── */}
      <section className="border-b border-charcoal-700/70 bg-gallery-wall">
        <div className="mx-auto max-w-[1500px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
          <div className="max-w-3xl space-y-6">
            <Reveal>
              <p className="eyebrow">For artists</p>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="text-display-xl">
                Sell your work
                <br />
                <span className="text-lime-300">on these walls.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="lede max-w-2xl">
                Open a storefront on Arts by Jay, list originals, prints or digital work, and keep the
                majority of every sale. Your pieces hang in the virtual gallery and appear throughout the
                shop like everyone else&apos;s.
              </p>
            </Reveal>
            <Reveal delay={220}>
              <div className="flex flex-wrap gap-3 pt-2">
                {alreadyArtist ? (
                  <Button variant="primary" size="lg" to="/artist">
                    Go to your dashboard
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : user ? (
                  <Button variant="primary" size="lg" href="#apply">
                    Apply with this account
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" size="lg" to="/register?as=artist">
                      Create an artist account
                    </Button>
                    <Button variant="outline" size="lg" to="/login">
                      I already have an account
                    </Button>
                  </>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] px-4 py-16 sm:px-6 lg:px-10">
        {/* ── The commercial terms, up front ── */}
        <Reveal>
          <div className="grid gap-5 sm:grid-cols-3">
            <StatCard
              label="You keep"
              value={commissionPercent != null ? `${100 - commissionPercent}%` : '—'}
              sublabel="of every sale, before payment-gateway fees"
              tone="accent"
            />
            <StatCard
              label="Platform fee"
              value={commissionPercent != null ? `${commissionPercent}%` : '—'}
              sublabel="covers hosting, the gallery and payment handling"
            />
            <StatCard label="Listing fee" value="None" sublabel="list as many pieces as you like" />
          </div>
        </Reveal>

        {/* ── Benefits ── */}
        <section className="mt-20" aria-labelledby="benefits-heading">
          <SectionHeader eyebrow="What you get" title="A storefront, not a submission box" className="mb-10" />

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((benefit, index) => {
              const Icon = benefit.icon;

              return (
                <Reveal key={benefit.title} delay={index * 70}>
                  <div className="panel h-full space-y-3.5 p-6">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-lime-300/12 text-lime-300">
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-xl">{benefit.title}</h3>
                    <p className="text-[0.85rem] leading-relaxed text-muted">{benefit.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="mt-20" aria-labelledby="process-heading">
          <SectionHeader eyebrow="The process" title="From application to first sale" className="mb-10" />

          <ol className="space-y-5">
            {STEPS.map((step, index) => (
              <Reveal key={step} delay={index * 60}>
                <li className="flex gap-5 rounded-2xl border border-charcoal-700 bg-charcoal-850/40 p-5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime-300 font-mono text-[0.8rem] text-charcoal-950">
                    {index + 1}
                  </span>
                  <p className="pt-1.5 text-[0.92rem] leading-relaxed text-parchment/90">{step}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ── Application ── */}
        <section id="apply" className="mt-20 scroll-mt-24" aria-labelledby="apply-heading">
          <div className="mx-auto max-w-2xl">
            <SectionHeader
              eyebrow="Apply"
              title={alreadyArtist ? 'You already sell here' : 'Open your storefront'}
              className="mb-8"
            />

            {alreadyArtist ? (
              <div className="space-y-5 rounded-2xl border border-lime-300/25 bg-lime-300/[0.05] p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-lime-300 text-charcoal-950">
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-display text-xl">{artistProfile.displayName}</p>
                    <p className="text-[0.8rem] text-muted">
                      Your artist account is{' '}
                      <span className="text-parchment">
                        {artistProfile.status === 'approved' ? 'approved and live' : artistProfile.status}
                      </span>
                      .
                    </p>
                  </div>
                </div>

                {artistProfile.status === 'pending' && (
                  <NoticeBanner tone="info" title="Still under review">
                    You can set up your profile and prepare drafts now. A curator will approve your account
                    shortly, and then you can publish.
                  </NoticeBanner>
                )}

                <div className="flex flex-wrap gap-2.5">
                  <Button variant="primary" to="/artist">
                    Open my dashboard
                  </Button>
                  <Button variant="secondary" to="/artist/artworks/new">
                    Add a piece
                  </Button>
                  {artistProfile.status === 'approved' && (
                    <Button variant="ghost" to={`/artists/${artistProfile.slug}`}>
                      View my public storefront
                    </Button>
                  )}
                </div>
              </div>
            ) : user ? (
              <form onSubmit={apply} className="space-y-5" noValidate>
                {error && (
                  <NoticeBanner tone="warning" title="That did not go through">
                    {error}
                  </NoticeBanner>
                )}

                <NoticeBanner tone="info">
                  You are applying with <span className="text-parchment">{user.email}</span>. Your existing
                  orders and wishlist stay exactly as they are.
                </NoticeBanner>

                <Field
                  label="Artist name"
                  htmlFor="apply-name"
                  hint="How you want to be credited on every piece."
                  error={fieldErrors.displayName}
                  required
                >
                  <Input
                    id="apply-name"
                    value={form.displayName}
                    onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                    error={fieldErrors.displayName}
                    required
                  />
                </Field>

                <Field label="Where you work" htmlFor="apply-location" hint="Optional.">
                  <Input
                    id="apply-location"
                    value={form.location}
                    onChange={(event) => setForm({ ...form, location: event.target.value })}
                    placeholder="Ahmedabad, India"
                  />
                </Field>

                <Field
                  label="About your work"
                  htmlFor="apply-bio"
                  hint="What you make, how you make it, and what you are after. This is what a curator reads."
                  error={fieldErrors.bio}
                >
                  <Textarea
                    id="apply-bio"
                    value={form.bio}
                    onChange={(event) => setForm({ ...form, bio: event.target.value })}
                    rows={6}
                    maxLength={4000}
                    placeholder="I paint large colour fields in thin oil glazes…"
                    error={fieldErrors.bio}
                  />
                </Field>

                <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
                  Send my application
                </Button>

                <p className="text-[0.78rem] leading-relaxed text-muted">
                  Applications are reviewed by a person. You can build your profile and prepare drafts
                  straight away — only publishing waits on approval.
                </p>
              </form>
            ) : (
              <div className="space-y-5 rounded-2xl border border-charcoal-700 bg-charcoal-850/50 p-6 text-center">
                <p className="text-[0.92rem] leading-relaxed text-muted">
                  Create an account to apply. It takes a minute, and you can start uploading drafts
                  immediately.
                </p>
                <div className="flex flex-wrap justify-center gap-2.5">
                  <Button variant="primary" size="lg" to="/register?as=artist">
                    Create an artist account
                  </Button>
                  <Button variant="secondary" size="lg" to="/login">
                    Sign in instead
                  </Button>
                </div>
                <p className="text-[0.78rem] text-muted">
                  Already collecting here?{' '}
                  <Link to="/login" className="text-lime-300 underline-offset-4 hover:underline">
                    Sign in
                  </Link>{' '}
                  and apply with the account you have.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default BecomeArtistPage;
