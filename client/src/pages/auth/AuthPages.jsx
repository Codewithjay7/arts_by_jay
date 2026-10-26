import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Palette, ShoppingBag } from 'lucide-react';
import clsx from 'clsx';
import { Button, Checkbox, Field, Input, NoticeBanner } from '../../components/ui';
import { useAuth } from '../../store/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { useUi } from '../../store/ui';

/**
 * Shared two-column shell: form on the left, editorial panel on the right.
 * Exported so the password pages wear the same frame without duplicating it.
 */
export const AuthShell = ({ title, subtitle, children, footer }) => (
  <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1500px] lg:grid-cols-2">
    <div className="flex items-center justify-center px-4 py-14 sm:px-8">
      <div className="w-full max-w-md space-y-7">
        <div className="space-y-2">
          <Link to="/" className="inline-block font-display text-2xl tracking-tight">
            Arts by <span className="text-accent-300">Jay</span>
          </Link>
          <h1 className="pt-4 text-display-md">{title}</h1>
          {subtitle && <p className="lede">{subtitle}</p>}
        </div>

        {children}

        {footer && <div className="border-t border-line pt-5 text-center text-sm">{footer}</div>}
      </div>
    </div>

    <aside className="relative hidden overflow-hidden border-l border-line bg-gallery-wall lg:block">
      <div className="absolute inset-0 grid place-items-center p-14">
        <div className="max-w-md space-y-6">
          <p className="eyebrow">Arts by Jay</p>
          <blockquote className="font-display text-3xl leading-tight text-ink">
            A marketplace where the artist sets the price, keeps the majority, and the work hangs in a
            gallery you can walk through.
          </blockquote>
          <ul className="space-y-3 text-[0.88rem] text-muted">
            <li className="flex items-start gap-3">
              <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
              Buy originals, limited prints and digital work directly from the studio.
            </li>
            <li className="flex items-start gap-3">
              <Palette className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" aria-hidden="true" />
              Or open a storefront of your own and start selling.
            </li>
          </ul>
        </div>
      </div>
    </aside>
  </div>
);

export const PasswordInput = ({ id, value, onChange, error, autoComplete, placeholder }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        error={error}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:text-ink"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
};

/* ──────────────────────────── Sign in ──────────────────────────── */

export const LoginPage = () => {
  useDocumentTitle('Sign in');

  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuth((state) => state.login);
  const success = useUi((state) => state.success);

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const destination = location.state?.from ?? '/';

  const onSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await login(form);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    success(`Welcome back, ${result.user.name.split(' ')[0]}`);

    // Send each role to the place they most likely came to use.
    if (destination !== '/') navigate(destination, { replace: true });
    else if (result.user.role === 'admin') navigate('/admin');
    else if (result.user.role === 'artist') navigate('/artist');
    else navigate('/');
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your cart, wishlist and orders are waiting."
      footer={
        <p className="text-muted">
          No account yet?{' '}
          <Link to="/register" className="text-accent-300 underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <NoticeBanner tone="warning" title="We could not sign you in">
            {error}
          </NoticeBanner>
        )}

        <Field label="Email" htmlFor="login-email" required>
          <Input
            id="login-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field label="Password" htmlFor="login-password" required>
          <PasswordInput
            id="login-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="current-password"
            placeholder="Your password"
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          Sign in
        </Button>

        {/* Until this link existed, requestPasswordReset had no caller
            anywhere in the UI and anyone who forgot their password was
            locked out for good. */}
        <p className="text-center text-[0.82rem]">
          <Link
            to="/forgot-password"
            className="text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Forgotten your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};

/* ──────────────────────────── Register ──────────────────────────── */

export const RegisterPage = () => {
  useDocumentTitle('Create an account');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuth((state) => state.register);
  const success = useUi((state) => state.success);

  // /register?as=artist arrives from the "Become an artist" page.
  const [intent, setIntent] = useState(searchParams.get('as') === 'artist' ? 'artist' : 'customer');

  const [form, setForm] = useState({ name: '', email: '', password: '', artistName: '' });
  const [agreed, setAgreed] = useState(false);
  // Set when Supabase accepts the signup but issues no session, because
  // email confirmation is required.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  // Set when the account was created but its profile row — and therefore its
  // role — is not readable yet.
  const [profilePending, setProfilePending] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();

    if (!agreed) {
      setError('Please confirm you agree to the marketplace terms.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await register({ ...form, intent });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      setFieldErrors(result.details ?? {});
      return;
    }

    /**
     * With email confirmation enabled, Supabase returns no session. Navigating
     * here would drop the visitor into a signed-out app having just told them
     * their account was ready — and an artist would then be bounced straight
     * back out by the role guard.
     */
    if (result.needsEmailConfirmation) {
      setAwaitingConfirmation(true);
      return;
    }

    /**
     * Created, but we could not read the profile that holds the role.
     * Announcing "your account is ready" and navigating would land an artist
     * on a page the role guard immediately bounces them out of, with no
     * explanation — a success message followed by a locked door.
     */
    if (result.profilePending) {
      setProfilePending(true);
      return;
    }

    success('Your account is ready');
    navigate(intent === 'artist' ? '/artist/storefront' : '/');
  };

  if (profilePending) {
    return (
      <AuthShell
        title="Account created"
        subtitle="One short step before you can use it."
      >
        <div className="space-y-5">
          <NoticeBanner tone="info" title="Please sign in">
            Your account was created, but we could not finish reading it just now, so we have not
            guessed at what you should see. Signing in resolves it.
          </NoticeBanner>

          <p className="text-[0.9rem] leading-relaxed text-muted">
            Nothing is wrong with the account itself — the email <strong>{form.email}</strong> is
            registered. Do not register again; that address is taken now.
          </p>

          <Button variant="primary" to="/login">
            Go to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (awaitingConfirmation) {
    return (
      <AuthShell
        title="Confirm your email"
        subtitle={`We have sent a confirmation link to ${form.email}.`}
      >
        <div className="space-y-5">
          <NoticeBanner tone="info" title="One more step">
            Open the link in that email to activate your account, then sign in. The link is what proves
            the address is yours, so we cannot skip it.
          </NoticeBanner>

          <p className="text-[0.9rem] leading-relaxed text-muted">
            Nothing arrived? Check the spam folder. This project has no custom mail service configured
            yet, so confirmation emails come from Supabase&apos;s shared sender and are rate limited —
            they can take a few minutes, or be dropped altogether under load.
          </p>

          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" to="/login">
              Go to sign in
            </Button>
            <Button variant="ghost" onClick={() => setAwaitingConfirmation(false)}>
              Use a different email
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account to collect art, or to sell it."
      footer={
        <p className="text-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-accent-300 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <NoticeBanner tone="warning" title="Please check the form">
            {error}
          </NoticeBanner>
        )}

        {/* ── Role chooser ──
             Only these two are offered. The administrator role cannot be
             requested here, and the server would refuse it if it were. */}
        <fieldset className="space-y-2.5">
          <legend className="text-[0.8rem] font-medium text-ink">I am here to</legend>
          <div className="grid grid-cols-2 gap-2.5">
            <IntentCard
              selected={intent === 'customer'}
              onClick={() => setIntent('customer')}
              icon={ShoppingBag}
              title="Collect art"
              description="Browse and buy work"
            />
            <IntentCard
              selected={intent === 'artist'}
              onClick={() => setIntent('artist')}
              icon={Palette}
              title="Sell my art"
              description="Open a storefront"
            />
          </div>
        </fieldset>

        {intent === 'artist' && (
          <NoticeBanner tone="info" title="Artist accounts are reviewed">
            You can set up your profile and prepare drafts straight away. A curator approves your account
            before your work goes live on the marketplace.
          </NoticeBanner>
        )}

        <Field label="Your name" htmlFor="register-name" error={fieldErrors.name} required>
          <Input
            id="register-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            autoComplete="name"
            placeholder="Your full name"
            error={fieldErrors.name}
            required
          />
        </Field>

        {intent === 'artist' && (
          <Field
            label="Artist name"
            htmlFor="register-artist-name"
            hint="How you want to be credited. Leave blank to use your own name."
            error={fieldErrors.artistName}
          >
            <Input
              id="register-artist-name"
              value={form.artistName}
              onChange={(event) => setForm({ ...form, artistName: event.target.value })}
              placeholder="The name you sign your work with"
            />
          </Field>
        )}

        <Field label="Email" htmlFor="register-email" error={fieldErrors.email} required>
          <Input
            id="register-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            placeholder="you@example.com"
            error={fieldErrors.email}
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="register-password"
          hint="At least 10 characters, with a letter and a number."
          error={fieldErrors.password}
          required
        >
          <PasswordInput
            id="register-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="new-password"
            placeholder="Choose a strong password"
            error={fieldErrors.password}
          />
        </Field>

        <Checkbox
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          label="I agree to the marketplace terms"
          description="Artwork remains the property of its artist. Payments are handled by the configured payment gateway."
        />

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          {intent === 'artist' ? 'Create my artist account' : 'Create my account'}
        </Button>
      </form>
    </AuthShell>
  );
};

const IntentCard = ({ selected, onClick, icon: Icon, title, description }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={clsx(
      'rounded-2xl border p-4 text-left transition-all',
      selected
        ? 'border-accent-300 bg-accent-300/[0.07]'
        : 'border-line-strong hover:border-surface-400 hover:bg-surface-0',
    )}
  >
    <Icon className={clsx('h-5 w-5', selected ? 'text-accent-300' : 'text-muted')} aria-hidden="true" />
    <p className="mt-2.5 text-sm font-medium text-ink">{title}</p>
    <p className="mt-0.5 text-[0.75rem] text-muted">{description}</p>
  </button>
);

export default LoginPage;
