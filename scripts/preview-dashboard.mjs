import fs from 'node:fs/promises';
import path from 'node:path';
import { dev } from 'astro';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Isolated, read-only preview: no application middleware, database or credentials.
const root = process.cwd();
const includeHomepage = process.argv.includes('--homepage');
const previewRoot = path.join(root, includeHomepage ? 'output/homepage-preview' : 'output/dashboard-preview');
const pages = path.join(previewRoot, 'src/pages');
await fs.mkdir(pages, { recursive: true });
const today = new Date();
const day = (offset) => { const value = new Date(today); value.setDate(value.getDate() + offset); return value.toISOString(); };
const projectNames = ['Blackhill Drive extension', 'The garden room', 'West End townhouse', 'Lochside new build', 'Park Terrace conversion'];
const stages = ['PLANNING', 'DESIGN', 'BUILDING_WARRANT', 'SURVEY', 'CONSTRUCTION'];
const projects = projectNames.map((name, index) => ({
  id: `preview-${index + 1}`, name, stage: stages[index], status: 'ACTIVE',
  clientName: ['Prestige Properties', 'Emma & James Wilson', 'Alexander Reid', 'Sarah MacLeod', 'Parkside Developments'][index],
  siteSummary: ['147 Blackhill Drive, Glasgow', '24 Victoria Road, Bearsden', '8 Great Western Terrace, Glasgow', 'Loch Lomond, West Dunbartonshire', '16 Park Terrace, Glasgow'][index],
  documentReviewCount: index === 0 ? 3 : index === 2 ? 2 : 0, readyAutomationJobCount: index === 0 ? 1 : 0,
  nextDeadline: { title: ['Planning decision target', 'Design review', 'Warrant response target', 'Site survey', 'Completion documents'][index], dueDate: day([4, 6, 8, 11, 15][index]) },
  nextAction: { label: ['Review supporting documents', 'Continue design development', 'Review council response', 'Prepare survey information', 'Upload completion documents'][index], href: `/projects/preview-${index + 1}`, tone: index === 0 || index === 2 ? 'warning' : 'neutral' },
}));
const deadlines = [
  { id: 'deadline-1', title: 'Submit revised drawings', dueDate: day(-1), status: 'OVERDUE', priority: 'HIGH', type: 'INTERNAL', project: { id: 'preview-3', name: projectNames[2] } },
  { id: 'deadline-2', title: 'Planning decision target', dueDate: day(4), status: 'UPCOMING', priority: 'MEDIUM', type: 'PLANNING', project: { id: 'preview-1', name: projectNames[0] } },
  { id: 'deadline-3', title: 'Client design review', dueDate: day(6), status: 'UPCOMING', priority: 'MEDIUM', type: 'INTERNAL', project: { id: 'preview-2', name: projectNames[1] } },
  { id: 'deadline-4', title: 'Warrant response target', dueDate: day(8), status: 'UPCOMING', priority: 'MEDIUM', type: 'BUILDING_WARRANT', project: { id: 'preview-3', name: projectNames[2] } },
];
const summary = {
  activeProjects: 12, upcomingDeadlineCount: 4, documentsNeedingReview: 5, automationJobsReady: 2,
  planningActionCount: 3, warrantActionCount: 2, deadlineRange: 14,
  pipeline: [
    { key: 'lead', label: 'Lead', count: 2, href: '/projects?stage=LEAD' },
    { key: 'documents', label: 'Documents', count: 4, href: '/projects' },
    { key: 'planning', label: 'Planning', count: 3, href: '/projects?stage=PLANNING' },
    { key: 'warrant', label: 'Building Warrant', count: 3, href: '/projects' },
    { key: 'complete', label: 'Complete', count: 6, href: '/projects?stage=COMPLETION' },
  ],
  documentOverview: { total: 86, reviewed: 81, needsReview: 5 },
  actionWorkload: { overdueDeadlines: 1, planningActions: 3, warrantActions: 2, automationReady: 2 },
  activeProjectSummaries: projects, upcomingDeadlines: deadlines,
  needsAttention: [
    { id: 'attention-1', type: 'Overdue deadline', projectName: projectNames[2], reason: 'Submit revised drawings', date: day(-1), href: '/deadlines?projectId=preview-3', tone: 'danger' },
    { id: 'attention-2', type: 'Documents to review', projectName: projectNames[0], reason: '3 supporting documents need review', href: '/projects/preview-1/files', tone: 'warning' },
    { id: 'attention-3', type: 'Needs your review', projectName: projectNames[2], reason: 'Building warrant ready for final review', href: '/projects/preview-3/building-warrant', tone: 'warning' },
    { id: 'attention-4', type: 'Automation ready', projectName: projectNames[0], reason: 'Planning application prepared', href: '/projects/preview-1/planning', tone: 'ready' },
  ],
};
const auth = { user: { name: 'Jayveer', email: 'jayveer@example.com' }, organisation: { name: 'Your organisation' }, membership: { role: 'OWNER' } };
const source = await fs.readFile(path.join(root, 'src/pages/dashboard.astro'), 'utf8');
const previewSource = source
  .replace(/import \{ requirePageAuth \} from [^;]+;/, '')
  .replace(/const auth = await requirePageAuth\(Astro as never\);\s*if \(!auth\) return Astro.redirect\('\/login'\);/, `const auth = ${JSON.stringify(auth)};`)
  .replace('<AppShell ', '<AppShell preview ');
await fs.writeFile(path.join(pages, 'dashboard.astro'), previewSource);
const withoutSession = (source) => source.replace(/import \{ getSessionUser \} from [^;]+;/, "const getSessionUser = async (context) => context.request.headers.get('x-preview-signed-in') === 'yes' ? { id: 'preview-user' } : null;");
if (includeHomepage) {
  for (const route of ['index', 'login', 'register', 'privacy', 'terms']) {
    const source = await fs.readFile(path.join(root, `src/pages/${route}.astro`), 'utf8');
    await fs.writeFile(path.join(pages, `${route}.astro`), withoutSession(source));
  }
} else await fs.writeFile(path.join(pages, 'index.astro'), "---\nreturn Astro.redirect('/dashboard');\n---\n");
await fs.writeFile(path.join(pages, '[...path].astro'), `---\nimport BaseLayout from '@/layouts/BaseLayout.astro';\n---\n<BaseLayout title="Dashboard preview | Architect Pro" noindex><main style="max-width:650px;margin:12vh auto;padding:32px;font-family:Segoe UI,sans-serif"><h1>This is a dashboard preview</h1><p>Project and application links connect to their existing pages in the full application. This isolated preview uses sample data and does not access your records.</p><a href="/dashboard" style="display:inline-block;margin-top:20px;text-decoration:underline">Back to dashboard</a></main></BaseLayout>`);
const server = await dev({
  root: previewRoot, configFile: false, publicDir: path.join(root, 'public'),
  devToolbar: { enabled: false }, server: { host: '127.0.0.1', port: includeHomepage ? 4323 : 4322 },
  integrations: [react(), tailwind({ configFile: path.join(root, 'tailwind.config.mjs'), applyBaseStyles: false })],
  vite: {
    resolve: { alias: { '@': path.join(root, 'src') } },
    server: { fs: { allow: [root] } },
    plugins: [{ name: 'dashboard-preview-data', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'This preview is read only.' })); return; }
      const url = new URL(req.url, 'http://preview');
      if (url.pathname === '/api/dashboard/summary') {
        const range = Number(url.searchParams.get('deadlineRange') || 14);
        const upcoming = deadlines.filter(item => new Date(item.dueDate).getTime() <= today.getTime() + range * 86400000);
        const state = new URL(req.headers.referer || 'http://preview').searchParams.get('state');
        if (state === 'error') { res.statusCode = 503; res.end(JSON.stringify({ error: 'Preview connection interrupted. Try again.' })); return; }
        res.end(JSON.stringify(state === 'empty' ? { ...summary, activeProjects: 0, documentsNeedingReview: 0, automationJobsReady: 0, planningActionCount: 0, warrantActionCount: 0, upcomingDeadlineCount: 0, pipeline: [], activeProjectSummaries: [], needsAttention: [], upcomingDeadlines: [], documentOverview: { total: 0, reviewed: 0, needsReview: 0 }, actionWorkload: { overdueDeadlines: 0, planningActions: 0, warrantActions: 0, automationReady: 0 } } : { ...summary, deadlineRange: range, upcomingDeadlines: upcoming, upcomingDeadlineCount: upcoming.length })); return;
      }
      if (url.pathname === '/api/automation-jobs/queue') { res.end(JSON.stringify({ active: [] })); return; }
      if (url.pathname === '/api/settings/desktop-agents') { res.end(JSON.stringify({ agents: [{ id: 'preview-agent', connected: true, usable: true, revokedAt: null }] })); return; }
      if (url.pathname === '/api/calendar') {
        const month = url.searchParams.get('month') || today.toISOString().slice(0, 7);
        const first = new Date(`${month}-01T00:00:00Z`); const start = new Date(first); start.setUTCDate(1 - (first.getUTCDay() + 6) % 7);
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 41);
        res.end(JSON.stringify({ month, gridStart: start.toISOString(), gridEnd: end.toISOString(), deadlines, googleConnection: null })); return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'Not available in the dashboard preview.' }));
    }); } }],
  },
});
console.log(`DASHBOARD_PREVIEW_URL=http://127.0.0.1:${server.address.port}/dashboard`);
if (includeHomepage) console.log(`HOMEPAGE_PREVIEW_URL=http://127.0.0.1:${server.address.port}/`);
const stop = async () => { await server.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
