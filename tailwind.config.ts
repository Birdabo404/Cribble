import type { Config } from 'tailwindcss'

// Theme-aware scales: every value points at a CSS variable defined in
// globals.css, so `html.light` flips the entire palette (dark surfaces
// become light, text flips, etc.) without touching component classes.
const zinc = {
  50: 'rgb(var(--z50) / <alpha-value>)',
  100: 'rgb(var(--z100) / <alpha-value>)',
  200: 'rgb(var(--z200) / <alpha-value>)',
  300: 'rgb(var(--z300) / <alpha-value>)',
  400: 'rgb(var(--z400) / <alpha-value>)',
  500: 'rgb(var(--z500) / <alpha-value>)',
  600: 'rgb(var(--z600) / <alpha-value>)',
  700: 'rgb(var(--z700) / <alpha-value>)',
  800: 'rgb(var(--z800) / <alpha-value>)',
  900: 'rgb(var(--z900) / <alpha-value>)',
  950: 'rgb(var(--z950) / <alpha-value>)',
}

const gray = {
  50: 'rgb(var(--g50) / <alpha-value>)',
  100: 'rgb(var(--g100) / <alpha-value>)',
  200: 'rgb(var(--g200) / <alpha-value>)',
  300: 'rgb(var(--g300) / <alpha-value>)',
  400: 'rgb(var(--g400) / <alpha-value>)',
  500: 'rgb(var(--g500) / <alpha-value>)',
  600: 'rgb(var(--g600) / <alpha-value>)',
  700: 'rgb(var(--g700) / <alpha-value>)',
  800: 'rgb(var(--g800) / <alpha-value>)',
  900: 'rgb(var(--g900) / <alpha-value>)',
  950: 'rgb(var(--g950) / <alpha-value>)',
}

const config: Config = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        black: 'rgb(var(--c-black) / <alpha-value>)',
        white: 'rgb(var(--c-white) / <alpha-value>)',
        zinc,
        gray,
        // Cribble brand colors
        'cribble-teal': '#4ecdc4',
        'cribble-dark': '#1a1a1a',
        'cribble-purple': '#6366f1',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
