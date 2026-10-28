import fs from 'node:fs/promises';
import path from 'node:path';
import { dev } from 'astro';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { prisma } from '../src/lib/db/prisma.ts';
import { getDashboardSummary } from '../src/pages/api/dashboard/summary.ts';
import { getCalendarGridRange, normaliseCalendarMonth } from '../src/lib/calendar/month.ts';
import { agentSupportsJob, isHealthyAgent } from '../src/server/services/desktop-agent.service.ts';

// Local, read-only QA server. Never mounts production middleware or mutation routes.
// Run: node --env-file=.env --import tsx scripts/preview-dashboard-live.mjs
const root = process.cwd();
const previewRoot = path.join(root, 'output/dashboard-live-preview');
const pages = path.join(previewRoot, 'src/pages');
const organisationId = process.env.DASHBOARD_ORGANISATION_ID;
if (!organisationId) throw new Error('Set DASHBOARD_ORGANISATION_ID to the practice to preview.');
const membership = await prisma.organisationMember.findFirst({
  where: { organisationId }, select: { role: true, user: { select: { id: true, name: true, email: true } }, organisation: { select: { name: true } } }, orderBy: { createdAt: 'asc' },
});
if (!membership) throw new Error('Practice membership not found.');
const auth = { user: membership.user, organisation: { id: organisationId, name: membership.organisation.name }, membership: { role: membership.role } };
await fs.mkdir(pages, { recursive: true });
for (const route of ['dashboard', 'projects/index', 'projects/[id]', 'calendar', 'deadlines']) {
  const source = await fs.readFile(path.join(root, `src/pages/${route}.astro`), 'utf8');
  const target = path.join(pages, `${route}.astro`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source
    .replace(/import \{ requirePageAuth \} from [^;]+;/, '')
    .replace(/const auth = await requirePageAuth\(Astro as never\);\s*if \(!auth\) return Astro.redirect\('\/login'\);/, `const auth = ${JSON.stringify(auth)};`));
}
await fs.writeFile(path.join(pages, 'index.astro'), "---\nreturn Astro.redirect('/dashboard');\n---\n");
await fs.writeFile(path.join(pages, '[...path].astro'), `---
import BaseLayout from '@/layouts/BaseLayout.astro';
---
<BaseLayout title="Read-only dashboard preview" noindex><main class="mx-auto max-w-3xl px-6 py-16"><h1 class="text-2xl font-semibold">Read-only dashboard preview</h1><p class="mt-4">This link opens its existing workflow in the full application. Changes and submissions are disabled in this local preview.</p><a class="btn btn-secondary mt-6" href="/dashboard">Back to dashboard</a></main></BaseLayout>`);
const server = await dev({
  root: previewRoot, configFile: false, output: 'server', publicDir: path.join(root, 'public'), devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4324 },
  integrations: [react(), tailwind({ configFile: path.join(root, 'tailwind.config.mjs'), applyBaseStyles: false })],
  vite: { resolve: { alias: { '@': path.join(root, 'src') } }, server: { fs: { allow: [root] } },
    plugins: [{ name: 'read-only-dashboard', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end('Read-only preview.'); return; }
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://preview');
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'private, no-store');
        try {
          let result;
          if (url.pathname === '/api/dashboard/summary') result = await getDashboardSummary(organisationId, url.searchParams);
          else if (url.pathname === '/api/automation-jobs/queue') {
            result = { active: await prisma.automationJob.findMany({ where: { organisationId, OR: [
              { status: 'READY', executionAuthorisedAt: { not: null } }, { status: { in: ['CLAIMED', 'IN_PROGRESS'] } },
              { status: 'NEEDS_REVIEW', claimedByAgentId: { not: null } },
              { status: 'CANCELLED', claimedByAgentId: { not: null }, events: { none: { eventType: 'execution_released' } } },
            ] }, select: { id: true, title: true, type: true, status: true, executionAuthorisedAt: true, createdAt: true, progressStage: true, progressStageState: true, progressPercent: true, progressMessage: true, project: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }) };
          } else if (url.pathname === '/api/settings/desktop-agents') {
            const agents = await prisma.agentRegistration.findMany({ where: { organisationId }, select: { id: true, machineName: true, agentVersion: true, capabilities: true, enabled: true, revokedAt: true, lastSeenAt: true, operatingState: true, createdAt: true } });
            result = { agents: agents.map(agent => ({ ...agent, connected: isHealthyAgent(agent), usable: isHealthyAgent(agent) && ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT'].some(type => agentSupportsJob(agent, { type, payloadVersion: 2 })) })), canManageAll: ['OWNER', 'ADMIN'].includes(membership.role) };
          } else if (url.pathname === '/api/calendar') {
            const month = normaliseCalendarMonth(url.searchParams.get('month'));
            const { gridStart, gridEnd } = getCalendarGridRange(month);
            const [deadlines, googleConnection] = await Promise.all([
              prisma.deadline.findMany({ where: { organisationId, status: { not: 'CANCELLED' }, dueDate: { gte: url.searchParams.get('dashboardDates') === 'true' ? new Date(gridStart.getTime() - 86400000) : gridStart, lt: gridEnd } }, orderBy: { dueDate: 'asc' }, select: { id: true, title: true, dueDate: true, status: true, priority: true, type: true, project: { select: { id: true, name: true } } } }),
              prisma.calendarConnection.findUnique({ where: { organisationId_provider: { organisationId, provider: 'GOOGLE' } }, select: { status: true, accountEmail: true, lastSyncedAt: true, syncError: true } }),
            ]);
            result = { month, gridStart, gridEnd, deadlines, googleConnection };
          } else { res.statusCode = 404; result = { error: 'Not available in the read-only preview.' }; }
          res.end(JSON.stringify(result));
        } catch (error) { console.error(error); res.statusCode = 500; res.end(JSON.stringify({ error: 'Preview data could not be loaded.' })); }
      });
    } }],
  },
});
console.log(`LIVE_DASHBOARD_PREVIEW=http://127.0.0.1:${server.address.port}/dashboard`);
const stop = async () => { await server.stop(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
