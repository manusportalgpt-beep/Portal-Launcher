import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        primary: 'var(--color-primary)',
        modrinth: 'var(--color-modrinth)',
        curseforge: 'var(--color-curseforge)',
      },
      borderRadius: {
        button: 'var(--radius-button)',
        card: 'var(--radius-card)',
        modal: 'var(--radius-modal)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        pixel: ['Press Start 2P', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
