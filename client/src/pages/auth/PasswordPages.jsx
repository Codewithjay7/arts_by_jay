import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input, NoticeBanner } from '../../components/ui';
import { AuthShell, PasswordInput } from './AuthPages';
import { requestPasswordReset, changePassword } from '../../lib/data/auth';
import { supabase } from '../../lib/supabase';
import { useDocumentTitle } from '../../lib/hooks';
import { useUi } from '../../store/ui';

/**
 * Password recovery.
 *
 * Both halves of this flow existed in pieces and worked in neither direction:
 * `requestPasswordReset` was in the data layer with no caller anywhere in the
 * UI, so a visitor who forgot their password was locked out permanently; and
 * the link it sends pointed at /login, which is wrapped in
 * RedirectIfAuthenticated. Arriving from a recovery link ESTABLISHES a
 * session, so the visitor was bounced to the home page, silently signed in,
 * with nowhere to set a password.
 *
 * These two pages complete it. ResetPasswordPage is deliberately NOT behind
 * RedirectIfAuthenticated, for the reason above.
 */

/* ───────────────────────── Request a reset ───────────────────────── */

export const ForgotPasswordPage = () => {
  useDocumentTitle('Reset your password');

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={`If ${email} has an account, a reset link is on its way.`}>
        <div className="space-y-5">
          {/* Phrased as a conditional on purpose. "We have emailed you" would
              confirm whether that address is registered, which is exactly what
              requestPasswordReset avoids revealing. */}
          <NoticeBanner tone="info" title="What happens next">
            Open the link in that email to choose a new password. Links expire after an hour.
          </NoticeBanner>

          <p className="text-[0.9rem] leading-relaxed text-muted">
            Nothing arrived? Check the spam folder. This deployment has no custom mail service
            configured, so these emails come from Supabase&apos;s shared sender and are rate limited —
            they can take a few minutes, or be dropped altogether under load.
          </p>

          <Button variant="secondary" to="/login">
            Back to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a link to choose a new one."
      footer={
        <p className="text-muted">
          Remembered it?{' '}
          <Link to="/login" className="text-accent-300 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <NoticeBanner tone="warning" title="We could not send that email">
            {error}
          </NoticeBanner>
        )}

        <Field label="Email" htmlFor="forgot-email" required>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          Email me a reset link
        </Button>
      </form>
    </AuthShell>
  );
};

/* ───────────────────────── Choose a new password ───────────────────────── */

export const ResetPasswordPage = () => {
  useDocumentTitle('Choose a new password');

  const navigate = useNavigate();
  const success = useUi((state) => state.success);

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // 'checking' until we know whether the link produced a usable session.
  const [linkState, setLinkState] = useState('checking');

  useEffect(() => {
    if (!supabase) {
      setLinkState('invalid');
      return undefined;
    }

    let cancelled = false;

    // Supabase parses the tokens out of the URL fragment asynchronously and
    // fires PASSWORD_RECOVERY once it has. Subscribe BEFORE reading the
    // session, or a fast parse lands between the two calls and the page shows
    // "link expired" for a perfectly good link.
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setLinkState('ready');
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      // A session already in place is enough: updateUser will accept a new
      // password. Without one, the link was never valid or has expired.
      setLinkState((current) => (current === 'ready' ? current : data?.session ? 'ready' : 'invalid'));
    });

    return () => {
      cancelled = true;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();

    if (password !== confirmation) {
      setError('Those two passwords do not match.');
      return;
    }
    if (password.length < 10) {
      setError('Use at least 10 characters, with a letter and a number.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await changePassword({ newPassword: password });
      success('Password changed', 'You can use it from now on.');
      navigate('/', { replace: true });
    } catch (changeError) {
      setError(changeError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (linkState === 'checking') {
    return (
      <AuthShell title="Checking your link" subtitle="One moment.">
        <p className="text-[0.9rem] text-muted">Reading the reset link&hellip;</p>
      </AuthShell>
    );
  }

  if (linkState === 'invalid') {
    return (
      <AuthShell title="That link is no longer valid" subtitle="Reset links expire after an hour.">
        <div className="space-y-5">
          <NoticeBanner tone="warning" title="Nothing has been changed">
            Your password is unchanged and your account is untouched. Request a fresh link and use it
            straight away.
          </NoticeBanner>

          <Button variant="primary" to="/forgot-password">
            Send a new link
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This replaces your old one immediately.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <NoticeBanner tone="warning" title="Password not changed">
            {error}
          </NoticeBanner>
        )}

        <Field
          label="New password"
          htmlFor="reset-password"
          hint="At least 10 characters, with a letter and a number."
          required
        >
          <PasswordInput
            id="reset-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Choose a strong password"
          />
        </Field>

        <Field label="Confirm new password" htmlFor="reset-password-confirm" required>
          <PasswordInput
            id="reset-password-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            placeholder="Type it again"
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          Save new password
        </Button>
      </form>
    </AuthShell>
  );
};
