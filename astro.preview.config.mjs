import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import config from './astro.config.mjs';

export default defineConfig({
  ...config,
  adapter: node({ mode: 'standalone' }),
  outDir: './output/local-preview/',
  server: { ...config.server, host: '127.0.0.1' },
});
