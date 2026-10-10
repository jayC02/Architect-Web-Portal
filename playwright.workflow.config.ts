import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'workflow-browser.spec.ts', workers: 1, timeout: 300_000,
  outputDir: 'output/playwright/workflow', reporter: [['list'], ['json', { outputFile: 'output/workflow/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4330', headless: true, channel: 'chrome', contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure' } });
