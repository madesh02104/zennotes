/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Warm paper palette inspired by the reference screenshot
        paper: {
          50: '#fdfbf7',
          100: '#faf7f0',
          200: '#f5f0e6',
          300: '#ebe4d5',
          400: '#d9d0bd',
          500: '#b8ad94'
        },
        ink: {
          900: '#2a2620',
          800: '#3a332a',
          700: '#4e4537',
          600: '#6a6050',
          500: '#8a8073',
          400: '#a89f90',
          300: '#c4baa9'
        },
        accent: {
          DEFAULT: '#e97b3c',
          soft: '#f39568',
          muted: '#f5b895'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Inter"', 'system-ui', 'sans-serif'],
        serif: ['"Iowan Old Style"', '"Source Serif Pro"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace']
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(42, 38, 32, 0.04), 0 8px 28px -12px rgba(42, 38, 32, 0.12)',
        float: '0 20px 60px -20px rgba(42, 38, 32, 0.25)'
      }
    }
  },
  plugins: []
}
