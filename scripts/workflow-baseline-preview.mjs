import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const isolated = value => { const url = new URL(value); url.searchParams.set('schema', 'workflow_overhaul_preview_20261009'); return url.toString(); };
const env = { ...process.env, DATABASE_URL: isolated(process.env.DATABASE_URL), DIRECT_URL: isolated(process.env.DIRECT_URL || process.env.DATABASE_URL), DEBUG_PERF: '', PUBLIC_SITE_URL: 'http://127.0.0.1:4332', PUBLIC_ALLOWED_ORIGINS: 'http://127.0.0.1:4332', UPLOAD_STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'http://127.0.0.1:4331', SUPABASE_SERVICE_ROLE_KEY: 'loopback-test-key', SUPABASE_STORAGE_BUCKET: 'mock-bucket', DOCUMENT_AI_PROVIDER: '' };
const result = spawnSync(process.execPath, [path.resolve('node_modules/astro/astro.js'), 'dev', '--host', '127.0.0.1', '--port', '4332'], { cwd: 'output/workflow/baseline-app', env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
