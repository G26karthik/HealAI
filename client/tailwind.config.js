/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Tier palette. Every one of these hits WCAG AA on white at text sizes,
        // and no status is ever conveyed by colour alone — icon + label always.
        tier: { t1: '#b91c1c', t2: '#c2410c', t3: '#1d4ed8', t4: '#15803d' },

        // Brand. Deep navy carries the trust; teal is the action colour; red is
        // reserved exclusively for emergency, so it never loses its urgency.
        brand: {
          50: '#eef7f8',
          100: '#d3ecef',
          200: '#a8d9e0',
          300: '#6fbecb',
          400: '#3d9dae',
          500: '#238095',
          600: '#1a687e',
          700: '#175467',
          800: '#164555',
          900: '#0e2f3c',
          950: '#071c25',
        },
        ink: '#0b1b26',
        muted: '#4a5c68',
        line: '#e3e9ed',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(11,27,38,.05), 0 8px 24px -12px rgba(11,27,38,.18)',
        lift: '0 2px 4px rgba(11,27,38,.06), 0 18px 40px -18px rgba(11,27,38,.34)',
        glow: '0 0 0 1px rgba(35,128,149,.18), 0 12px 32px -12px rgba(35,128,149,.5)',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.92)', opacity: '0.65' },
          '100%': { transform: 'scale(1.55)', opacity: '0' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(3%,-4%,0) scale(1.08)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ticker: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        rise: 'rise .5s cubic-bezier(.22,1,.36,1) both',
        floaty: 'floaty 6s ease-in-out infinite',
        drift: 'drift 18s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        ticker: 'ticker 32s linear infinite',
      },
    },
  },
  plugins: [],
};
