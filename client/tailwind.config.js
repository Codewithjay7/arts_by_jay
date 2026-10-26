/** Arts by Jay — dark charcoal and lime-green gallery theme. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: {
          950: '#0a0b0a',
          900: '#0f110f',
          850: '#141714',
          800: '#1a1d19',
          750: '#212520',
          700: '#2a2f28',
          600: '#3a4038',
          500: '#4e554b',
        },
        lime: {
          DEFAULT: '#c5ff3d',
          50: '#f7ffe8',
          100: '#eeffc9',
          200: '#dcff94',
          300: '#c5ff3d',
          400: '#b2f024',
          500: '#95cf15',
          600: '#74a50f',
          700: '#587d12',
          800: '#466314',
          900: '#3a5315',
        },
        parchment: '#f4f6f2',
        muted: '#9aa196',
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
        frame: '0 30px 60px -20px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.05)',
        lift: '0 20px 45px -25px rgba(0,0,0,0.8)',
        glow: '0 0 40px -8px rgba(197,255,61,0.35)',
      },
      backgroundImage: {
        'gallery-wall':
          'radial-gradient(120% 80% at 50% 0%, #22261f 0%, #151814 45%, #0d0f0c 100%)',
        'lime-sweep': 'linear-gradient(100deg, #c5ff3d 0%, #95cf15 100%)',
      },
      transitionTimingFunction: {
        gallery: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.4s ease both',
        shimmer: 'shimmer 1.6s linear infinite',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};
