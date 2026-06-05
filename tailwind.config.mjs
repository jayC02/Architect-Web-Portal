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
      },
      boxShadow: {
        line: '0 0 0 1px rgba(32,35,31,0.08)',
      },
    },
  },
  plugins: [],
};
