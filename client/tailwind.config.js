/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Tier palette. Every one of these hits WCAG AA on white at text sizes,
        // and no status is ever conveyed by colour alone — icon + label always.
        tier: {
          t1: '#b91c1c',
          t2: '#c2410c',
          t3: '#1d4ed8',
          t4: '#15803d',
        },
        ink: '#0f172a',
        muted: '#475569',
        line: '#e2e8f0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: { pulseRing: 'pulseRing 1.6s ease-out infinite' },
    },
  },
  plugins: [],
};
