/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Aptos', 'Segoe UI', 'ui-sans-serif', 'system-ui'],
        mono: ['Cascadia Mono', 'Segoe UI Mono', 'ui-monospace', 'SFMono-Regular'],
        display: ['Aptos Display', 'Aptos', 'Segoe UI', 'ui-sans-serif'],
      },
      colors: {
        ink: '#20231f',
        paper: '#f7f4ed',
        clay: '#a45d43',
        moss: '#68765c',
        steel: '#556777',
        // TailAdmin (MIT) brand scale, used by the dashboard.
        brand: {
          50: '#ecf3ff', 100: '#dde9ff', 200: '#c2d6ff', 300: '#9cb9ff', 400: '#7592ff',
          500: '#465fff', 600: '#3641f5', 700: '#2a31d8', 800: '#252dae', 900: '#262e89', 950: '#161950',
        },
      },
      fontSize: {
        'title-sm': ['18px', '28px'],
        'title-lg': ['20px', '30px'],
        'title-md': ['24px', '32px'],
      },
      boxShadow: {
        line: '0 0 0 1px rgba(32,35,31,0.08)',
        'theme-xs': '0px 1px 2px 0px rgba(16, 24, 40, 0.05)',
        'theme-sm': '0px 1px 3px 0px rgba(16, 24, 40, 0.1), 0px 1px 2px 0px rgba(16, 24, 40, 0.06)',
        'theme-md': '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
      },
    },
  },
  plugins: [],
};
