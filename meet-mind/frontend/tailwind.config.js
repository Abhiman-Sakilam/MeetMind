/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#100b08',
          50: '#f8f5f2',
          100: '#ebe4de',
          200: '#d3c7bd',
          300: '#b3a497',
          400: '#8f8075',
          500: '#6b5d53',
          600: '#4a3e36',
          700: '#2e2520',
          800: '#1a130f',
          900: '#100b08',
          950: '#090401',
        },
        accent: {
          DEFAULT: '#fa6114',
          light: '#ff8a3d',
          dark: '#e2571f',
          glow: 'rgba(250, 97, 20, 0.25)',
        },
      },
      fontFamily: {
        sans: [
          'Bricolage Grotesque',
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
          '0%': { boxShadow: '0 0 5px rgba(250,97,20,0.3), 0 0 10px rgba(250,97,20,0.1)' },
          '100%': { boxShadow: '0 0 10px rgba(250,97,20,0.5), 0 0 20px rgba(250,97,20,0.2)' },
        },
      },
    },
  },
  plugins: [],
};
