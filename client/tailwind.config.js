/**
 * Arts by Jay — midnight charcoal, warm ivory, burnt terracotta.
 *
 * The intent is a contemporary gallery after closing time: warm darkness,
 * ivory type, and terracotta used sparingly enough that it still reads as an
 * accent. The paintings supply the colour; the interface gets out of the way.
 *
 * The `accent` scale is deliberately NOT ordered light-to-dark in the usual
 * Tailwind way. 300 is the primary terracotta, 200 is the lighter hover and
 * 400 the darker pressed state, because that is how the components use them:
 *   bg-accent-300  hover:bg-accent-200  active:bg-accent-400
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Warm charcoal. Every value carries a little red so the darks read
        // as unlit gallery wall rather than as switched-off screen.
        charcoal: {
          950: '#0D0C0B',
          900: '#121212', // primary background
          850: '#1C1B1A', // secondary background / panels
          800: '#242220',
          750: '#2B2826',
          700: '#37322F', // borders
          600: '#4A433E',
          500: '#5E554E',
        },

        // Burnt terracotta.
        accent: {
          50: '#FAF3EF',
          100: '#F2E0D6',
          200: '#D98565', // hover highlight (soft terracotta)
          300: '#C46A4A', // PRIMARY accent
          400: '#A85D43', // pressed / muted copper
          500: '#8E4C37',
          600: '#763E2C',
          700: '#5E3123',
          800: '#47251A',
          900: '#301912',
        },

        parchment: '#F4EFE6', // warm ivory — main text
        muted: '#B8AEA3', // soft taupe — secondary text
        frame: '#E8DFD1', // antique ivory — artwork mounts
        cream: '#F1EBE1', // light section background
        ink: '#171412', // text on a terracotta button
      },

      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        'display-xl': ['clamp(3rem, 9vw, 7.5rem)', { lineHeight: '0.92', letterSpacing: '-0.03em' }],
        'display-lg': ['clamp(2.25rem, 6vw, 4.5rem)', { lineHeight: '0.98', letterSpacing: '-0.02em' }],
        'display-md': ['clamp(1.75rem, 4vw, 2.75rem)', { lineHeight: '1.05', letterSpacing: '-0.01em' }],
      },

      boxShadow: {
        // A hung frame casts a long, soft shadow and catches a hairline of
        // light on its top edge.
        frame: '0 30px 60px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(244,239,230,0.06)',
        lift: '0 20px 45px -25px rgba(0,0,0,0.85)',
        // Restrained warm glow — never neon.
        glow: '0 0 36px -10px rgba(196,106,74,0.45)',
        'glow-sm': '0 0 18px -6px rgba(196,106,74,0.35)',
        inset: 'inset 0 1px 0 0 rgba(244,239,230,0.05)',
      },

      backgroundImage: {
        'gallery-wall': 'radial-gradient(120% 80% at 50% 0%, #241F1C 0%, #191715 45%, #0F0E0D 100%)',
        'terracotta-sweep': 'linear-gradient(100deg, #C46A4A 0%, #A85D43 100%)',
        'ivory-sweep': 'linear-gradient(100deg, #F4EFE6 0%, #E8DFD1 100%)',
        // Picture-light wash, used behind headings.
        spotlight: 'radial-gradient(60% 50% at 50% 0%, rgba(196,106,74,0.16) 0%, transparent 70%)',
      },

      transitionTimingFunction: {
        // Long tail, no overshoot: a camera easing to a stop.
        gallery: 'cubic-bezier(0.22, 1, 0.36, 1)',
        curtain: 'cubic-bezier(0.76, 0, 0.24, 1)',
      },

      transitionDuration: {
        cinematic: '900ms',
      },

      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },

        // ── Advanced motion ──

        // A canvas being uncovered rather than faded in.
        'reveal-up': {
          '0%': { clipPath: 'inset(100% 0 0 0)', transform: 'scale(1.06)' },
          '100%': { clipPath: 'inset(0 0 0 0)', transform: 'scale(1)' },
        },
        'reveal-left': {
          '0%': { clipPath: 'inset(0 100% 0 0)' },
          '100%': { clipPath: 'inset(0 0 0 0)' },
        },
        // Per-word rise, masked by its own line box.
        'line-rise': {
          '0%': { transform: 'translateY(110%) rotate(2deg)', opacity: '0' },
          '100%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
        },
        // Slow drift across a still image.
        'ken-burns': {
          '0%': { transform: 'scale(1.04) translate3d(0,0,0)' },
          '100%': { transform: 'scale(1.14) translate3d(-1.5%, -1.5%, 0)' },
        },
        // The breathing of a picture light on a dimmer.
        'light-breathe': {
          '0%, 100%': { opacity: '0.72' },
          '50%': { opacity: '1' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'stroke-draw': {
          '0%': { strokeDashoffset: '1' },
          '100%': { strokeDashoffset: '0' },
        },
        'curtain-up': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-101%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },

      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.4s ease both',
        shimmer: 'shimmer 1.6s linear infinite',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.22,1,0.36,1) both',

        'reveal-up': 'reveal-up 1.1s cubic-bezier(0.22,1,0.36,1) both',
        'reveal-left': 'reveal-left 0.9s cubic-bezier(0.76,0,0.24,1) both',
        'line-rise': 'line-rise 0.95s cubic-bezier(0.22,1,0.36,1) both',
        'ken-burns': 'ken-burns 22s ease-out alternate infinite',
        'light-breathe': 'light-breathe 6s ease-in-out infinite',
        marquee: 'marquee 38s linear infinite',
        'stroke-draw': 'stroke-draw 1.6s cubic-bezier(0.22,1,0.36,1) both',
        'curtain-up': 'curtain-up 1s cubic-bezier(0.76,0,0.24,1) both',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
