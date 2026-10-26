import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Download, Image as ImageIcon, Send, Trash2, Upload } from 'lucide-react';
import { getStudioConfig } from '../lib/data';
import { listArtists, createCommissionRequest } from '../lib/data/artist';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  LoadingBlock,
  NoticeBanner,
  SectionHeader,
  Select,
  Textarea,
} from '../components/ui';
import { Reveal } from '../components/motion/Reveal';
import { useDocumentTitle } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

const MAX_PREVIEW_PX = 1400;

export const StudioPage = () => {
  useDocumentTitle('Photo-to-Art Studio');

  const [searchParams] = useSearchParams();
  const user = useAuth((state) => state.user);
  const toast = useUi((state) => state.toast);

  const [photo, setPhoto] = useState(null); // { file, url, width, height }
  const [styleKey, setStyleKey] = useState(null);
  const [sendPhoto, setSendPhoto] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  const [form, setForm] = useState({
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    subject: '',
    message: '',
    preferredSize: '',
    budget: '',
    artistSlug: searchParams.get('artist') ?? '',
  });

  const config = useQuery({
    queryKey: ['studio-config'],
    queryFn: getStudioConfig,
    staleTime: 10 * 60 * 1000,
  });

  const artists = useQuery({
    queryKey: ['commission-artists'],
    queryFn: () => listArtists({ limit: 40 }),
    staleTime: 5 * 60 * 1000,
  });

  const styles = useMemo(() => config.data?.styles ?? [], [config.data]);
  const aiEnabled = config.data?.aiGeneration?.enabled === true;

  useEffect(() => {
    if (!styleKey && styles.length) setStyleKey(styles[0].key);
  }, [styles, styleKey]);

  // Prefill contact details for a signed-in customer.
  useEffect(() => {
    if (!user) return;
    setForm((current) => ({
      ...current,
      contactName: current.contactName || user.name,
      contactEmail: current.contactEmail || user.email,
      contactPhone: current.contactPhone || user.phone || '',
    }));
  }, [user]);

  // Release the object URL when the photo changes or the page unmounts, so a
  // dropped file is not kept alive in memory.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const onPickFile = (file) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'That is not an image', message: 'Choose a JPEG, PNG or WebP photograph.', tone: 'negative' });
      return;
    }

    const maxMb = config.data?.maxUploadMb ?? 8;
    if (file.size > maxMb * 1024 * 1024) {
      toast({ title: 'That photo is too large', message: `Please choose an image under ${maxMb} MB.`, tone: 'negative' });
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const image = new Image();
    image.onload = () => {
      setPhoto({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      toast({ title: 'That image could not be read', message: 'Try a different file.', tone: 'negative' });
    };
    image.src = url;
  };

  const clearPhoto = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPhoto(null);
    setSendPhoto(false);
    setPhotoConsent(false);
  };

  /**
   * Flattens the current preview to a PNG the visitor can keep. Done entirely
   * on a canvas in the browser — the photo is not uploaded to produce this.
   */
  const downloadPreview = () => {
    if (!photo) return;

    const style = styles.find((entry) => entry.key === styleKey);
    const scale = Math.min(1, MAX_PREVIEW_PX / Math.max(photo.width, photo.height));
    const width = Math.round(photo.width * scale);
    const height = Math.round(photo.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    const image = new Image();

    image.onload = () => {
      if (style?.cssFilter) context.filter = style.cssFilter;
      context.drawImage(image, 0, 0, width, height);
      context.filter = 'none';

      // Re-create the overlay wash the CSS preview applies.
      if (style?.overlay) {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(196,106,74,0.16)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.12)');
        context.globalCompositeOperation = 'overlay';
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
      }

      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `arts-by-jay-${styleKey}-preview.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      }, 'image/png');
    };

    image.src = photo.url;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!form.message.trim() || form.message.trim().length < 10) {
      setFieldErrors({ message: 'Tell the studio a little about what you have in mind.' });
      return;
    }
    if (sendPhoto && !photoConsent) {
      setFormError('Tick the consent box before sending your photograph.');
      return;
    }

    setSubmitting(true);

    try {
      const artist = artists.data?.items?.find((entry) => entry.slug === form.artistSlug);

      /**
       * The photograph is only passed along when the visitor ticked both
       * boxes. Without consent the file never leaves the browser, and the
       * data layer refuses to upload it even if it were passed.
       */
      const files = sendPhoto && photo ? [photo.file] : [];

      const data = await createCommissionRequest(
        {
          kind: 'photo_to_art',
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone,
          subject: form.subject || `Photo-to-Art commission (${styleKey})`,
          message: form.message,
          styleKey: styleKey ?? '',
          preferredSize: form.preferredSize,
          budget: form.budget || null,
          artistId: artist?.id,
          photoConsent: sendPhoto && photoConsent,
        },
        files,
      );

      setSubmitted(data);
      toast({ title: 'Your brief has been sent', message: `Reference ${data.request.reference}`, tone: 'positive' });
    } catch (error) {
      setFormError(error.message || 'That could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (config.isLoading) return <LoadingBlock label="Opening the studio" className="min-h-[60vh]" />;

  const activeStyle = styles.find((entry) => entry.key === styleKey);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="space-y-3">
        <p className="eyebrow">Photo-to-Art</p>
        <h1 className="text-display-lg">The studio</h1>
        <p className="lede max-w-2xl">
          Bring a photograph, try it in four treatments, then send it to an artist as the starting point
          for a commissioned piece.
        </p>
      </header>

      {/* The single most important honesty statement on this page. */}
      <NoticeBanner
        tone={aiEnabled ? 'info' : 'warning'}
        title={aiEnabled ? 'AI generation is configured' : 'These previews are rendered in your browser'}
        className="mt-7 max-w-3xl"
      >
        {config.data?.aiGeneration?.notice}
        {!aiEnabled && (
          <>
            {' '}
            They are <span className="text-amber-200">colour treatments, not generated artwork</span> — a
            quick way to show an artist the mood you are after. Your photograph never leaves this device
            unless you choose to attach it below.
          </>
        )}
      </NoticeBanner>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {/* ──────────────── Preview column ──────────────── */}
        <div className="space-y-6">
          <SectionHeader eyebrow="Step one" title="Your photograph" />

          {!photo ? (
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onPickFile(event.dataTransfer.files?.[0]);
              }}
              className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-strong px-6 py-20 text-center transition-colors hover:border-accent-300/40"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-150 text-muted">
                <ImageIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="space-y-1.5">
                <p className="text-ink">Drop a photograph here</p>
                <p className="text-[0.8rem] text-muted">
                  JPEG, PNG or WebP, up to {config.data?.maxUploadMb ?? 8} MB. It stays on your device.
                </p>
              </div>
              <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Choose a photo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => onPickFile(event.target.files?.[0])}
                className="sr-only"
                aria-label="Choose a photograph"
              />
            </div>
          ) : (
            <>
              {/* The treated preview, framed as if it were already a piece. */}
              <div className="art-frame aspect-[4/5] sm:aspect-[4/3]">
                <div className="relative h-full w-full overflow-hidden">
                  <img
                    src={photo.url}
                    alt="Your photograph, with the selected treatment applied"
                    className="h-full w-full object-cover transition-[filter] duration-700 ease-gallery"
                    style={{ filter: activeStyle?.cssFilter }}
                  />
                  {activeStyle?.overlay && (
                    <span
                      className="pointer-events-none absolute inset-0 mix-blend-overlay transition-opacity duration-700"
                      style={{ background: activeStyle.overlay }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Change photo
                </Button>
                <Button variant="ghost" size="sm" onClick={downloadPreview}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Save this preview
                </Button>
                <Button variant="ghost" size="sm" onClick={clearPhoto}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={(event) => onPickFile(event.target.files?.[0])}
                  className="sr-only"
                  aria-label="Choose a photograph"
                />
              </div>
            </>
          )}

          {/* ── Style chooser ── */}
          <div className="space-y-4">
            <SectionHeader eyebrow="Step two" title="Choose a treatment" />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {styles.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  onClick={() => setStyleKey(style.key)}
                  aria-pressed={styleKey === style.key}
                  className={clsx(
                    'group overflow-hidden rounded-xl border text-left transition-all',
                    styleKey === style.key
                      ? 'border-accent-300 ring-1 ring-accent-300/40'
                      : 'border-line-strong hover:border-surface-400',
                  )}
                >
                  {/* Each swatch previews the visitor's own photo when there
                      is one, so the choice is meaningful rather than abstract. */}
                  <div className="relative aspect-square overflow-hidden bg-surface-150">
                    {photo ? (
                      <>
                        <img
                          src={photo.url}
                          alt=""
                          className="h-full w-full object-cover"
                          style={{ filter: style.cssFilter }}
                        />
                        <span
                          className="absolute inset-0 mix-blend-overlay"
                          style={{ background: style.overlay }}
                          aria-hidden="true"
                        />
                      </>
                    ) : (
                      <span
                        className="block h-full w-full"
                        style={{ background: style.overlay }}
                        aria-hidden="true"
                      />
                    )}
                    {styleKey === style.key && (
                      <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent-300 text-white">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <p className="px-2.5 py-2 text-[0.8rem] text-ink">{style.name}</p>
                </button>
              ))}
            </div>

            {activeStyle && (
              <p className="text-[0.84rem] leading-relaxed text-muted">{activeStyle.description}</p>
            )}
          </div>
        </div>

        {/* ──────────────── Brief column ──────────────── */}
        <div id="commission" className="space-y-6">
          <SectionHeader
            eyebrow="Step three"
            title="Send it to an artist"
            description="Describe what you want made. The artist replies with a quote and a timeline."
          />

          {submitted ? (
            <div className="space-y-5 rounded-2xl border border-accent-300/25 bg-accent-300/[0.05] p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-300 text-white">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-display text-xl">Your brief is with the studio</p>
                  <p className="font-mono text-[0.78rem] text-muted">{submitted.request.reference}</p>
                </div>
              </div>

              <p className="text-[0.86rem] leading-relaxed text-muted">{submitted.notice}</p>

              <div className="flex flex-wrap gap-2.5">
                {user && (
                  <Button variant="secondary" to="/account/commissions">
                    Track my enquiries
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSubmitted(null);
                    setForm((current) => ({ ...current, message: '', subject: '' }));
                  }}
                >
                  Send another brief
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              {formError && (
                <NoticeBanner tone="warning" title="Please check the form">
                  {formError}
                </NoticeBanner>
              )}

              <Field label="Which artist?" htmlFor="studio-artist" hint="Leave as any to let the studio assign it.">
                <Select
                  id="studio-artist"
                  value={form.artistSlug}
                  onChange={(event) => setForm({ ...form, artistSlug: event.target.value })}
                >
                  <option value="">Any available artist</option>
                  {(artists.data?.items ?? [])
                    .filter((artist) => artist.acceptsCommissions)
                    .map((artist) => (
                      <option key={artist.id} value={artist.slug}>
                        {artist.displayName}
                        {artist.location ? ` — ${artist.location}` : ''}
                      </option>
                    ))}
                </Select>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Your name" htmlFor="studio-name" error={fieldErrors.contactName} required>
                  <Input
                    id="studio-name"
                    value={form.contactName}
                    onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                    error={fieldErrors.contactName}
                    autoComplete="name"
                    required
                  />
                </Field>
                <Field label="Email" htmlFor="studio-email" error={fieldErrors.contactEmail} required>
                  <Input
                    id="studio-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                    error={fieldErrors.contactEmail}
                    autoComplete="email"
                    required
                  />
                </Field>
              </div>

              <Field label="Phone" htmlFor="studio-phone" hint="Optional.">
                <Input
                  id="studio-phone"
                  type="tel"
                  value={form.contactPhone}
                  onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                  autoComplete="tel"
                />
              </Field>

              <Field
                label="What would you like made?"
                htmlFor="studio-message"
                error={fieldErrors.message}
                hint="The subject, the mood, where it will hang, anything that matters to you."
                required
              >
                <Textarea
                  id="studio-message"
                  value={form.message}
                  onChange={(event) => setForm({ ...form, message: event.target.value })}
                  error={fieldErrors.message}
                  rows={5}
                  maxLength={5000}
                  placeholder="A portrait of our dog from this photograph, in the Ink & Wash treatment, about 60cm square for a hallway with warm light…"
                  required
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Preferred size" htmlFor="studio-size" hint="Optional.">
                  <Input
                    id="studio-size"
                    value={form.preferredSize}
                    onChange={(event) => setForm({ ...form, preferredSize: event.target.value })}
                    placeholder="60 × 60 cm"
                  />
                </Field>
                <Field label="Budget" htmlFor="studio-budget" hint="Optional, in rupees.">
                  <Input
                    id="studio-budget"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.budget}
                    onChange={(event) => setForm({ ...form, budget: event.target.value })}
                    placeholder="40000"
                  />
                </Field>
              </div>

              {/* ── Consent ──
                   A private photograph is only stored, or passed on, when the
                   visitor explicitly asks for it. */}
              {photo && (
                <div className="space-y-3 rounded-2xl border border-line bg-surface-0/50 p-5">
                  <p className="eyebrow">Your photograph</p>
                  <Checkbox
                    checked={sendPhoto}
                    onChange={(event) => {
                      setSendPhoto(event.target.checked);
                      if (!event.target.checked) setPhotoConsent(false);
                    }}
                    label="Attach my photograph to this brief"
                    description="Without this, only your written description is sent and the photo stays on your device."
                  />
                  {sendPhoto && (
                    <Checkbox
                      checked={photoConsent}
                      onChange={(event) => setPhotoConsent(event.target.checked)}
                      label="I consent to this photograph being stored and shown to the artist"
                      description={
                        aiEnabled
                          ? 'It will be stored on the marketplace and may be sent to the configured image service to generate a reference.'
                          : 'It will be stored on the marketplace and shown only to the artist handling your commission. It is not sent to any external service.'
                      }
                    />
                  )}
                </div>
              )}

              {!user && (
                <NoticeBanner tone="info">
                  You can send this without an account. Signing in first lets you track the conversation and
                  the quote in one place.
                </NoticeBanner>
              )}

              <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
                <Send className="h-4 w-4" aria-hidden="true" />
                Send my brief
              </Button>
            </form>
          )}

          {/* ── How it works ── */}
          <div className="space-y-4 rounded-2xl border border-line bg-surface-0/40 p-6">
            <p className="eyebrow">How a commission works</p>
            <ol className="space-y-3 text-[0.84rem] leading-relaxed text-muted">
              {[
                'You send a brief, with or without a reference photograph.',
                'The artist replies with a quote, a size and a timeline.',
                'If you accept, the piece is made and you are kept updated.',
                'It is dispatched insured, and appears in your order history.',
              ].map((line, index) => (
                <li key={line} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[0.7rem]">
                    {index + 1}
                  </span>
                  {line}
                </li>
              ))}
            </ol>
            <p className="text-[0.75rem] text-muted">
              Nothing is charged at the brief stage. A commission is only paid for once you and the artist
              have agreed the quote.
            </p>
          </div>
        </div>
      </div>

      {/* ── Treatments, explained ── */}
      <section className="mt-20" aria-labelledby="styles-heading">
        <SectionHeader
          eyebrow="The four treatments"
          title="What each one does"
          className="mb-8"
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {styles.map((style, index) => (
            <Reveal key={style.key} delay={index * 70}>
              <div className="panel h-full space-y-3 p-5">
                <div
                  className="aspect-video rounded-lg"
                  style={{ background: style.overlay }}
                  aria-hidden="true"
                />
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg">{style.name}</h3>
                  <p className="text-[0.82rem] leading-relaxed text-muted">{style.description}</p>
                </div>
                <Badge>{aiEnabled ? 'AI reference available' : 'Browser preview'}</Badge>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
};

export default StudioPage;
