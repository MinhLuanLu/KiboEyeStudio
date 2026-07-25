import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#141417',
          panel: '#1c1c21',
          panel2: '#212227',
          border: '#2c2d33',
          border2: '#3a3b42',
          text: '#e6e6ea',
          muted: '#8b8c96',
          accent: '#5b8cff',
          accent2: '#7c5cff',
          warn: '#ffb454',
          danger: '#ff5c5c'
        }
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        panel: '0 4px 24px rgba(0,0,0,0.45)',
        floating: '0 8px 32px rgba(0,0,0,0.55)'
      }
    }
  },
  plugins: []
} satisfies Config
