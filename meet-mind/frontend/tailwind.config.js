/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0c0f1a',
          50: '#f0f1f5',
          100: '#d8dbe5',
          200: '#b1b7cb',
          300: '#8a93b1',
          400: '#636f97',
          500: '#3d4b7d',
          600: '#2a3561',
          700: '#1a2240',
          800: '#111729',
          900: '#0c0f1a',
          950: '#070a12',
        },
        accent: {
          DEFAULT: '#6366f1',
          light: '#818cf8',
          dark: '#4f46e5',
          glow: 'rgba(99, 102, 241, 0.25)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99,102,241,0.3), 0 0 10px rgba(99,102,241,0.1)' },
          '100%': { boxShadow: '0 0 10px rgba(99,102,241,0.5), 0 0 20px rgba(99,102,241,0.2)' },
        },
      },
    },
  },
  plugins: [],
};
