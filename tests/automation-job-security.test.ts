import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const createRoute = fs.readFileSync('src/pages/api/automation-jobs/index.ts', 'utf8');
const jobRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/index.ts', 'utf8');
const desktopRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/desktop.ts', 'utf8');
const service = fs.readFileSync('src/server/services/automation-jobs.service.ts', 'utf8');
const validation = fs.readFileSync('src/lib/validation/automation-job.ts', 'utf8');
const projectPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
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
assert.match(service, /automationJobSnapshotSchema\.parse/, 'snapshot service validates data snapshot before saving');
assert.match(service, /automationJobDocumentSnapshotSchema\.parse/, 'snapshot service validates document snapshot before saving');
assert.match(service, /assertSafeAutomationSnapshot\(dataSnapshot\)/, 'snapshot service rejects unsafe snapshot fields');
assert.doesNotMatch(service, /storageKey:\s*document\.storageKey|storageUrl:\s*document\.storageUrl/, 'snapshot service does not include raw storage references');

assert.match(validation, /'storageKey'/, 'snapshot validation forbids storageKey fields');
assert.match(validation, /'password'/, 'snapshot validation forbids password fields');
assert.match(validation, /'apiKey'/, 'snapshot validation forbids apiKey fields');
assert.match(projectPage, /Prepare householder job/, 'project detail page can prepare householder jobs');
assert.match(projectPage, /Prepare planning job/, 'project detail page can prepare planning jobs');
assert.match(projectPage, /Prepare warrant job/, 'project detail page can prepare building warrant jobs');
assert.match(jobsPage, /View snapshot contract/, 'automation jobs page exposes a reviewable snapshot contract');

console.log('automation job security tests passed');
