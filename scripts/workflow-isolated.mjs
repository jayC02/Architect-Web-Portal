import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const schema = 'workflow_overhaul_preview_20261009';
const database = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!database) throw new Error('Database configuration is required.');
const urlFor = value => { const url = new URL(value); url.searchParams.set('schema', schema); return url.toString(); };
const env = { ...process.env, DATABASE_URL: urlFor(process.env.DATABASE_URL || database), DIRECT_URL: urlFor(database),
  DEBUG_PERF: '',
  DOCUMENT_PROCESSING_ENABLED: process.env.WORKFLOW_BACKGROUND_PROCESSING ?? 'true', DOCUMENT_AI_PROVIDER: process.env.WORKFLOW_LIVE_AI === 'true' ? process.env.DOCUMENT_AI_PROVIDER ?? '' : '', UPLOAD_STORAGE_PROVIDER: 'local',
  PUBLIC_SITE_URL: 'http://127.0.0.1:4330', PUBLIC_ALLOWED_ORIGINS: 'http://127.0.0.1:4330',
};
if (process.env.WORKFLOW_MOCK_STORAGE === 'true') Object.assign(env, { UPLOAD_STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'http://127.0.0.1:4331', SUPABASE_SERVICE_ROLE_KEY: 'loopback-test-key', SUPABASE_STORAGE_BUCKET: 'mock-bucket' });
if (process.env.WORKFLOW_MOCK_AI === 'true') Object.assign(env, { DOCUMENT_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'loopback-test-key', NODE_OPTIONS: `--import ${pathToFileURL(path.resolve('scripts/workflow-mock-ai.mjs')).href}` });
const action = process.argv[2] ?? 'status';
if (action === 'init') {
  const sql = postgres(database, { max: 1 });
  try { await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); } finally { await sql.end(); }
  console.log('Isolated preview schema ready. Existing application schemas are unchanged.');
}
const mainApp = path.resolve('output/workflow/main-app');
if (action === 'dev-main') Object.assign(env, { PUBLIC_SITE_URL: 'http://127.0.0.1:4332', PUBLIC_ALLOWED_ORIGINS: 'http://127.0.0.1:4332' });
const command = action === 'dev' || action === 'dev-main' ? [path.resolve('node_modules/astro/astro.js'), 'dev', '--host', '127.0.0.1', '--port', action === 'dev-main' ? '4332' : '4330']
  : action === 'test' ? ['node_modules/tsx/dist/cli.mjs', ...process.argv.slice(3)]
  : ['node_modules/prisma/build/index.js', 'migrate', action === 'init' || action === 'deploy' ? 'deploy' : 'status'];
const result = spawnSync(process.execPath, command, { env, stdio: 'inherit', ...(action === 'dev-main' ? { cwd: mainApp } : {}) });
process.exit(result.status ?? 1);
