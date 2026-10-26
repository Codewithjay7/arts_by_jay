import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useReducedMotion } from '../../lib/hooks';

/* ═══════════════════════════ Curtain intro ═══════════════════════════ */

const INTRO_KEY = 'abj-intro-seen';

/**
 * The opening title card.
 *
 * Shown once per browser session, not once per page load, so moving around
 * the site does not replay it. Skipped entirely under reduced motion — a
 * full-screen overlay that cannot animate away is just an obstacle.
 *
 * The paint strokes are drawn with a stroke-dashoffset animation rather than
 * a video or GIF: a few hundred bytes, resolution-independent, and it stops
 * cleanly when motion is reduced.
 */
export const CurtainIntro = ({ onDone }) => {
  const reduced = useReducedMotion();

  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return 'done';
    try {
      return sessionStorage.getItem(INTRO_KEY) ? 'done' : 'playing';
    } catch {
      // Private mode or blocked storage: play it, just do not remember.
      return 'playing';
    }
  });

  useEffect(() => {
    if (state !== 'playing') return undefined;

    if (reduced) {
      setState('done');
      onDone?.();
      return undefined;
    }

    const lock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const lift = setTimeout(() => setState('lifting'), 1900);
    const finish = setTimeout(() => {
      setState('done');
      try {
        sessionStorage.setItem(INTRO_KEY, '1');
      } catch {
        /* nothing to persist to */
      }
      onDone?.();
    }, 2900);

    const skip = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.type === 'pointerdown') {
        setState('lifting');
      }
    };

    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);

    return () => {
      clearTimeout(lift);
      clearTimeout(finish);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
      document.body.style.overflow = lock;
    };
  }, [state, reduced, onDone]);

  if (state === 'done') return null;

  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-charcoal-950',
        state === 'lifting' && 'animate-curtain-up',
      )}
      // Decorative: a screen reader should not have to sit through it.
      aria-hidden="true"
    >
      {/* Two ivory strokes and one copper, drawn on. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" strokeLinecap="round" pathLength="1">
          <path
            d="M120 560 C 330 420, 520 650, 760 470 S 1010 330, 1120 410"
            stroke="var(--abj-frame)"
            strokeOpacity="0.18"
            strokeWidth="2.5"
            strokeDasharray="1"
            className="animate-stroke-draw"
          />
          <path
            d="M80 300 C 280 180, 470 400, 690 250 S 980 150, 1140 230"
            stroke="var(--abj-frame)"
            strokeOpacity="0.1"
            strokeWidth="1.5"
            strokeDasharray="1"
            className="animate-stroke-draw"
            style={{ animationDelay: '220ms' }}
          />
          <path
            d="M200 690 C 420 600, 600 740, 880 620"
            stroke="var(--abj-accent)"
            strokeOpacity="0.5"
            strokeWidth="3"
            strokeDasharray="1"
            className="animate-stroke-draw"
            style={{ animationDelay: '420ms' }}
          />
        </g>
      </svg>

      <div className="relative px-6 text-center">
        <p
          className="eyebrow mb-5 animate-fade-in"
          style={{ animationDelay: '700ms', animationDuration: '800ms' }}
        >
          Established by the artist
        </p>

        <h1 className="font-display text-[clamp(2.75rem,10vw,7rem)] leading-[0.92] tracking-tight">
          <span className="line-mask">
            <span>Arts by</span>
          </span>
          <span className="line-mask">
            <span className="text-accent-300" style={{ animationDelay: '180ms' }}>
              Jay
            </span>
          </span>
        </h1>

        <p
          className="mt-6 animate-fade-in font-mono text-[0.68rem] uppercase tracking-[0.3em] text-muted"
          style={{ animationDelay: '1200ms', animationDuration: '800ms' }}
        >
          A gallery you can walk through
        </p>
      </div>
    </div>,
    document.body,
  );
};

/* ═══════════════════════════ Marquee ═══════════════════════════ */

/**
 * An endless band of words.
 *
 * The children are rendered twice and the track moves exactly -50%, so the
 * seam is invisible with no measurement and no JavaScript. Pauses on hover so
 * anything readable can actually be read.
 */
export const Marquee = ({ items = [], className }) => {
  const reduced = useReducedMotion();
  if (!items.length) return null;

  const band = (
    <>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="flex shrink-0 items-center gap-10">
          <span className="font-display text-2xl text-parchment/80 sm:text-3xl">{item}</span>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-300/70" aria-hidden="true" />
        </span>
      ))}
    </>
  );

  if (reduced) {
    // A static, readable row instead of a moving one.
    return (
      <div className={clsx('flex flex-wrap items-center justify-center gap-x-10 gap-y-3', className)}>
        {band}
      </div>
    );
  }

  return (
    <div className={clsx('marquee', className)} role="presentation">
      <div className="marquee__track" aria-hidden="false">
        {band}
      </div>
      {/* The duplicate exists only to make the loop seamless. */}
      <div className="marquee__track" aria-hidden="true">
        {band}
      </div>
    </div>
  );
};

/* ═══════════════════════════ Cursor glow ═══════════════════════════ */

/**
 * A warm pool of light that follows the pointer.
 *
 * Writes two CSS custom properties and lets CSS paint it, so React never
 * re-renders on pointer movement. Coalesced into a single rAF, and skipped
 * entirely on touch devices (no hover) and under reduced motion.
 */
export const CursorGlow = () => {
  const reduced = useReducedMotion();
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) return undefined;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return undefined;

    const onMove = (event) => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        document.documentElement.style.setProperty('--abj-pointer-x', `${event.clientX}px`);
        document.documentElement.style.setProperty('--abj-pointer-y', `${event.clientY}px`);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [reduced]);

  if (reduced) return null;

  return <div className="cursor-glow hidden lg:block" aria-hidden="true" />;
};

/* ═══════════════════════════ Split heading ═══════════════════════════ */

/**
 * Splits a heading into line-masked words that rise into place.
 *
 * Each word gets its own overflow-hidden box, so it appears from behind its
 * own baseline rather than fading. The text stays a single readable string in
 * the accessibility tree because the wrappers are plain spans.
 */
export const RisingHeading = ({ text, accentFrom, as: Tag = 'h1', className, delay = 0, step = 70 }) => {
  const reduced = useReducedMotion();
  const words = String(text).split(' ');

  if (reduced) {
    return (
      <Tag className={className}>
        {words.map((word, index) => (
          <span key={index} className={index >= accentFrom ? 'text-accent-300' : undefined}>
            {word}
            {index < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      {words.map((word, index) => (
        <span key={index} className="line-mask mr-[0.25em] inline-block align-bottom">
          <span
            className={clsx('inline-block', accentFrom != null && index >= accentFrom && 'text-accent-300')}
            style={{ animationDelay: `${delay + index * step}ms` }}
          >
            {word}
          </span>
        </span>
      ))}
    </Tag>
  );
};
