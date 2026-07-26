import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const createRoute = fs.readFileSync('src/pages/api/automation-jobs/index.ts', 'utf8');
const jobRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/index.ts', 'utf8');
const desktopRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/desktop.ts', 'utf8');
const service = fs.readFileSync('src/server/services/automation-jobs.service.ts', 'utf8');
const validation = fs.readFileSync('src/lib/validation/automation-job.ts', 'utf8');
const projectPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
const applicationSummaryCard = fs.readFileSync('src/components/projects/ApplicationSummaryCard.astro', 'utf8');
const jobsPage = fs.readFileSync('src/pages/automation-jobs.astro', 'utf8');

assert.match(schema, /enum AutomationJobType/, 'schema defines automation job types');
assert.match(schema, /model AutomationJob/, 'schema defines automation job model');
assert.match(schema, /@@index\(\[organisationId, projectId, status, type, createdAt\]\)/, 'schema indexes org/project/status/type for queue lookups');
assert.match(schema, /dataSnapshot\s+Json/, 'schema stores data snapshot as JSON');
assert.match(schema, /documentSnapshot\s+Json/, 'schema stores document snapshot as JSON');

assert.match(createRoute, /assertAllowedOrigin\(context\.request\)/, 'automation job creation checks origin');
assert.match(createRoute, /assertRateLimit\(context,\s*rateLimitPolicies\.mutation,\s*'automation-jobs:create'\)/, 'automation job creation is rate limited');
assert.match(createRoute, /requireOrganisation\(context\)/, 'automation job creation requires organisation session');
assert.match(createRoute, /await requireProjectAccess\(organisation\.id,\s*body\.projectId\)/, 'automation job creation verifies project membership');
assert.match(createRoute, /organisationId:\s*organisation\.id/s, 'automation job creation uses organisation id from session');
assert.doesNotMatch(createRoute, /organisationId:\s*body\./, 'automation job creation does not trust submitted organisation ids');
assert.match(createRoute, /automationJobCreateSchema/, 'automation job creation validates input with zod');
assert.match(createRoute, /buildAutomationJobSnapshot/, 'automation job creation builds a trusted server-side snapshot');

assert.match(jobRoute, /where:\s*\{\s*id,\s*organisationId:\s*organisation\.id/s, 'job detail lookup is organisation scoped');
assert.match(jobRoute, /updateMany\(\{\s*where:\s*\{\s*id,\s*organisationId:\s*organisation\.id/s, 'job status update is organisation scoped');
assert.match(jobRoute, /assertAllowedOrigin\(context\.request\)/, 'job status update checks origin');
assert.match(jobRoute, /automationJobStatusUpdateSchema/, 'job status update validates allowed statuses');

assert.match(desktopRoute, /requireOrganisation\(context\)/, 'desktop handoff endpoint remains protected by organisation session in v1');
assert.match(desktopRoute, /organisationId:\s*organisation\.id/s, 'desktop handoff endpoint is organisation scoped');
assert.match(desktopRoute, /AutomationJobStatus\.READY/, 'desktop handoff endpoint only exposes ready or active jobs');
assert.doesNotMatch(desktopRoute, /storageKey|passwordHash|tokenHash/, 'desktop handoff endpoint does not explicitly select sensitive fields');

assert.match(service, /organisationId:\s*input\.organisationId/s, 'snapshot service queries are organisation scoped');
assert.match(service, /projectId:\s*project\.id/s, 'snapshot service keeps related records scoped to the project');
assert.match(service, /automationJobSnapshotV2Schema\.parse/, 'snapshot service validates the v2 data snapshot before saving');
assert.match(
  service,
  /documents:\s*dataSnapshot\.documents/,
  'document snapshot is derived from the validated v2 snapshot',
);
assert.match(service, /assertSafeAutomationSnapshot\(dataSnapshot\)/, 'snapshot service rejects unsafe snapshot fields');
assert.doesNotMatch(service, /storageKey:\s*document\.storageKey|storageUrl:\s*document\.storageUrl/, 'snapshot service does not include raw storage references');

assert.match(validation, /'storageKey'/, 'snapshot validation forbids storageKey fields');
assert.match(validation, /'password'/, 'snapshot validation forbids password fields');
assert.match(validation, /'apiKey'/, 'snapshot validation forbids apiKey fields');
assert.match(projectPage, /ApplicationSummaryCard/, 'project detail page uses the shared application summary');
assert.match(applicationSummaryCard, /AutomationLaunchButton/, 'application summaries use the one-click desktop launcher');
assert.match(applicationSummaryCard, /type="HOUSEHOLDER_PLANNING"/, 'application summaries can open householder jobs');
assert.match(applicationSummaryCard, /type="BUILDING_WARRANT"/, 'application summaries can open building warrant jobs');
assert.doesNotMatch(applicationSummaryCard, /type="PLANNING_APPLICATION"/, 'unsupported generic planning automation is not offered to desktop users');
assert.match(jobsPage, /Desktop Automation/, 'automation jobs page is reframed as Desktop Automation');
assert.match(jobsPage, /How desktop automation works/, 'automation jobs page explains the desktop handoff workflow');
assert.match(jobsPage, /Ready for desktop/, 'automation jobs page groups ready jobs with human-friendly copy');
assert.match(jobsPage, /title: 'Needs review'/, 'automation jobs page groups draft and final-review jobs as needs-review work');
assert.match(jobsPage, /View prepared details/, 'automation jobs page uses human-readable snapshot wording');
assert.match(jobsPage, /Show technical JSON/, 'automation jobs page hides raw JSON behind a secondary details section');
assert.match(jobsPage, /redactedSnapshot/, 'automation jobs page redacts sensitive snapshot keys before showing technical JSON');
assert.match(jobsPage, /data-job-group-link/, 'status summary links navigate to collapsible job groups');
assert.match(jobsPage, /<details id=\{`jobs-\$\{group\.key\}`\}/, 'job status groups are collapsible');
assert.match(jobsPage, /<h3 class="truncate text-lg font-semibold">\{projectName\}<\/h3>/, 'job rows lead with the project name');
assert.doesNotMatch(jobsPage, /<h3[^>]*>\{job\.title\}<\/h3>/, 'generated automation titles are not used as the visible row heading');
assert.doesNotMatch(jobsPage, /View snapshot contract/, 'automation jobs page no longer exposes technical snapshot wording as the primary action');

console.log('automation job security tests passed');
