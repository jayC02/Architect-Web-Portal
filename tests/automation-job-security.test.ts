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
const desktopStatus = fs.readFileSync('src/components/automation/DesktopAutomationStatus.astro', 'utf8');
const liveDesktopStatus = fs.readFileSync('src/components/automation/DesktopAutomationLiveCard.tsx', 'utf8');
const desktopStatusService = fs.readFileSync('src/server/services/desktop-automation-status.service.ts', 'utf8');
const jobsPage = fs.readFileSync('src/pages/automation-jobs.astro', 'utf8');
const preparationRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/preparation.ts', 'utf8');
const preparationPage = fs.readFileSync('src/pages/automation-job/[id].astro', 'utf8');

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
assert.match(
  service,
  /normaliseTypeOfWorkKeys\([\s\S]*warrantPreparation\.typeOfWorkKeys/,
  'the Building Warrant preparation data controls every selected type of work',
);
assert.match(
  service,
  /warrant\?\.presetKey \?\? project\.projectType/,
  'legacy warrant and project values remain a backward-compatible fallback',
);

assert.match(validation, /'storageKey'/, 'snapshot validation forbids storageKey fields');
assert.match(validation, /'password'/, 'snapshot validation forbids password fields');
assert.match(validation, /'apiKey'/, 'snapshot validation forbids apiKey fields');
assert.match(projectPage, /ApplicationSummaryCard/, 'project detail page uses the shared application summary');
assert.match(applicationSummaryCard, /DesktopAutomationStatus/, 'application summaries use one shared desktop status panel');
assert.match(desktopStatus, /AutomationLaunchButton/, 'the shared status panel keeps contextual manual preparation');
assert.match(liveDesktopStatus, /detailsHref/, 'the shared live status panel retains the secure job detail path');
assert.match(applicationSummaryCard, /AutomationJobType\.HOUSEHOLDER_PLANNING/, 'application summaries can open householder jobs');
assert.match(applicationSummaryCard, /AutomationJobType\.BUILDING_WARRANT/, 'application summaries can open building warrant jobs');
assert.doesNotMatch(applicationSummaryCard, /type="PLANNING_APPLICATION"/, 'unsupported generic planning automation is not offered to desktop users');
assert.match(jobsPage, /Desktop job history/, 'the retained support page uses history terminology');
assert.match(jobsPage, /organisationId: auth\.organisation\.id/, 'desktop history remains organisation scoped');
assert.match(jobsPage, /Active[\s\S]*Needs attention[\s\S]*History/, 'desktop history offers simple support filters');
assert.match(jobsPage, /job\.project\.name/, 'job rows lead with the project name');
assert.doesNotMatch(jobsPage, /Create desktop job/, 'desktop jobs cannot be created globally');
assert.doesNotMatch(jobsPage, /summaryCards|Show technical JSON|redactedSnapshot/, 'history removes dashboard cards and raw snapshot diagnostics');
assert.match(desktopStatusService, /organisationId: input\.organisationId/, 'shared current-job lookup is organisation scoped');
assert.match(desktopStatusService, /applicationId: input\.applicationId/, 'shared current-job lookup selects the relevant application');
assert.match(preparationRoute, /assertAllowedOrigin\(context\.request\)/, 'preparation updates validate origin');
assert.match(preparationRoute, /requireOrganisation\(context\)/, 'preparation updates require an organisation session');
assert.match(preparationRoute, /where:\s*\{\s*id:\s*jobId,\s*organisationId:\s*organisation\.id/s, 'prepared jobs are organisation scoped');
assert.doesNotMatch(preparationRoute, /organisationId:\s*(raw|value|body)\./, 'the preparation route never trusts a browser organisation id');
assert.match(preparationRoute, /buildAutomationJobSnapshot/, 'saving preparation automatically reruns deterministic readiness');
assert.match(preparationPage, /Information prepared from your documents/, 'the preparation page leads with prepared information');
assert.doesNotMatch(preparationPage, />Preflight</, 'preflight is not exposed as a user-facing destination');
assert.match(preparationPage, /href=\{`\/api\/documents\/\$\{document\.id\}`\}/, 'document links use the secure organisation-scoped preview route');

console.log('automation job security tests passed');
