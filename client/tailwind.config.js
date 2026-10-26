/**
 * Arts by Jay — light, editorial, artwork-first.
 *
 * The interface is deliberately almost colourless: near-white surfaces, one
 * near-black for type, one blue used sparingly. That is not minimalism for
 * its own sake — a marketplace selling paintings cannot afford to compete
 * with them. Every saturated pixel on the page should belong to an artwork.
 *
 * Token names are semantic, not descriptive, so a future palette change is a
 * values edit rather than a sweep through fifty files:
 *
 *   surface-*   backgrounds, from white (0) through to black (900)
 *   line        hairline borders
 *   ink         primary type
 *   muted       secondary type
 *   accent      the single blue, used for action and state only
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#FFFFFF', // cards, panels, elevated things
          100: '#F5F5F7', // page background
          150: '#F0F0F2', // hover on a card
          200: '#EBEBED', // pressed, inset wells
          300: '#E3E3E6', // sunken, scrollbar track
          400: '#AEAEB2', // disabled type, muted icons
          800: '#161617', // cinematic section, one step off black
          900: '#000000', // the gallery, and full-bleed dark sections
        },

        line: {
          DEFAULT: '#D2D2D7', // the only border weight needed
          strong: '#C7C7CC', // separators that must carry more weight
        },

        ink: {
          DEFAULT: '#1D1D1F', // primary type
          soft: '#424245', // headings on a dark section
        },

        muted: '#6E6E73', // secondary type

        accent: {
          50: '#F0F7FF',
          100: '#DCEBFC',
          200: '#3395F0', // lighter hover
          300: '#0071E3', // PRIMARY — actions and active state
          400: '#0062C4', // pressed
          500: '#0052A6',
          600: '#004488',
          700: '#00356B',
          800: '#00284F',
          900: '#001B36',
        },

        // Gallery furniture. A museum wall is not pure white and a mount is
        // not pure anything; these keep frames from looking like CSS boxes.
        frame: '#FBFBFD', // gallery wall
        cream: '#F5F2ED', // mount board
      },

      fontFamily: {
        /**
         * The system stack. On Apple platforms this resolves to San
         * Francisco, on Windows to Segoe UI, on Android to Roboto — each
         * already hinted for its own renderer, and none of them costing a
         * font request. The previous build loaded two webfonts from Google
         * for this; now it loads none.
         */
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        // Tight tracking and heavy weight at large sizes; the optical
        // correction a display face needs.
        'display-xl': [
          'clamp(2.75rem, 7vw, 5.5rem)',
          { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '600' },
        ],
        'display-lg': [
          'clamp(2rem, 5vw, 3.5rem)',
          { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-md': [
          'clamp(1.5rem, 3.2vw, 2.25rem)',
          { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '600' },
        ],
      },

      borderRadius: {
        // One generous radius used consistently, rather than five arbitrary ones.
        card: '18px',
        panel: '22px',
      },

      boxShadow: {
        // Light-theme elevation is a soft spread, not a hard drop. Two layers:
        // a tight contact shadow and a wide ambient one.
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -8px rgba(0,0,0,0.08)',
        lift: '0 2px 4px rgba(0,0,0,0.05), 0 18px 40px -12px rgba(0,0,0,0.14)',
        // A hung frame casts onto the wall below it.
        frame: '0 2px 6px rgba(0,0,0,0.06), 0 24px 48px -20px rgba(0,0,0,0.18)',
        inset: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
        focus: '0 0 0 4px rgba(0,113,227,0.25)',
      },

      backgroundImage: {
        // A museum wall: barely-there vertical falloff, no visible gradient.
        'gallery-wall': 'linear-gradient(180deg, #FFFFFF 0%, #FBFBFD 60%, #F5F5F7 100%)',
        'dark-section': 'linear-gradient(180deg, #000000 0%, #101011 100%)',
      },

      transitionTimingFunction: {
        // Long tail, no overshoot.
        gallery: 'cubic-bezier(0.22, 1, 0.36, 1)',
        // The easing used for a sheet or overlay.
        sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },

      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
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
        // A sheet rising from the bottom edge.
        'sheet-up': {
          '0%': { opacity: '0', transform: 'translateY(2rem) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Very slow drift on a hero still. Barely perceptible by design.
        'slow-pan': {
          '0%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1.08)' },
        },
      },

      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.45s ease both',
        shimmer: 'shimmer 1.6s linear infinite',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.32,0.72,0,1) both',
        'sheet-up': 'sheet-up 0.5s cubic-bezier(0.32,0.72,0,1) both',
        'slow-pan': 'slow-pan 28s ease-out alternate infinite',
      },
    },
  },
  plugins: [],
};
