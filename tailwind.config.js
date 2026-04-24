/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E40AF', // Blue-800
          light: '#3B82F6',   // Blue-500
          dark: '#1E3A8A',    // Blue-900
        },
        secondary: {
          DEFAULT: '#3B82F6', // Blue-500
          light: '#60A5FA',
          dark: '#2563EB',
        },
        cta: {
          DEFAULT: '#F59E0B', // Amber-500
          hover: '#D97706',   // Amber-600
        },
        dashboard: {
          bg: '#F8FAFC',      // Slate-50
          surface: '#FFFFFF', // White
          border: '#E2E8F0',  // Slate-200
        },
        text: {
          main: '#1E3A8A',    // Blue-900
          sub: '#475569',     // Slate-600
          muted: '#94A3B8',   // Slate-400
        }
      },
      fontFamily: {
        sans: ['"Fira Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwind-scrollbar'),
  ],
}
