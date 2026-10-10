import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const schema = 'workflow_overhaul_preview_20261009';
const database = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!database) throw new Error('Database configuration is required.');
const urlFor = value => { const url = new URL(value); url.searchParams.set('schema', schema); return url.toString(); };
const env = { ...process.env, DATABASE_URL: urlFor(process.env.DATABASE_URL || database), DIRECT_URL: urlFor(database),
  DEBUG_PERF: '',
  DOCUMENT_PROCESSING_ENABLED: 'true', DOCUMENT_AI_PROVIDER: '', UPLOAD_STORAGE_PROVIDER: 'local',
  PUBLIC_SITE_URL: 'http://127.0.0.1:4330', PUBLIC_ALLOWED_ORIGINS: 'http://127.0.0.1:4330',
};
if (process.env.WORKFLOW_MOCK_STORAGE === 'true') Object.assign(env, { UPLOAD_STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'http://127.0.0.1:4331', SUPABASE_SERVICE_ROLE_KEY: 'loopback-test-key', SUPABASE_STORAGE_BUCKET: 'mock-bucket' });
const action = process.argv[2] ?? 'status';
if (action === 'init') {
  const sql = postgres(database, { max: 1 });
  try { await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); } finally { await sql.end(); }
  console.log('Isolated preview schema ready. Existing application schemas are unchanged.');
}
const command = action === 'dev' ? ['node_modules/astro/astro.js', 'dev', '--host', '127.0.0.1', '--port', '4330']
  : action === 'test' ? ['node_modules/tsx/dist/cli.mjs', ...process.argv.slice(3)]
  : ['node_modules/prisma/build/index.js', 'migrate', action === 'init' || action === 'deploy' ? 'deploy' : 'status'];
const result = spawnSync(process.execPath, command, { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
