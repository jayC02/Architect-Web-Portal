import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

const site = (process.env.PUBLIC_SITE_URL || 'http://localhost:4321').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'server',
  adapter: vercel({ maxDuration: 240 }),
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  security: {
    checkOrigin: false,
  },
  vite: {
    server: { watch: { ignored: ['**/output/**'] } },
    build: {
      target: 'esnext',
    },
  },
});
