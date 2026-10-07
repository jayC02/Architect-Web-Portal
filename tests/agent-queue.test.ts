import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { planningApplicationFeeSchema } from '../src/lib/validation/domain';
import { jsonResponse } from '../src/lib/utils/http';
for (const [value, expected] of [['325.50', 325.5], ['0', 0], ['', undefined]] as const) assert.equal(planningApplicationFeeSchema.parse(value), expected);
for (const value of ['-1', '12.345', 'invalid', Infinity]) assert.equal(planningApplicationFeeSchema.safeParse(value).success, false);
const requests: any[] = [];
const records = Array.from({ length: 125 }, (_, index) => ({ id: `job-${index}`, organisationId: 'org-a', projectId: `project-${index % 3}`, status: 'READY', executionAuthorisedAt: new Date(index), createdAt: new Date(index) }));
records.push({ ...records[0], id: 'foreign', organisationId: 'org-b' }, { ...records[0], id: 'draft', executionAuthorisedAt: null as any });
for (const status of ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'FAILED', 'COMPLETED', 'CANCELLED', 'STALE']) {
  records.push({ ...records[0], id: status, status });
}
const matches = (job: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
  if (key === 'OR') return value.some((part: any) => matches(job, part));
  if (value && typeof value === 'object') {
    if ('in' in value) return value.in.includes(job[key]);
    if ('not' in value) return job[key] !== value.not;
  }
  return job[key] === value;
});
const modules: any = {
  '@/lib/db/prisma': { prisma: { automationJob: { findMany: async (query: any) => {
    requests.push(query);
    const found = records.filter(job => matches(job, query.where));
    return query.take ? found.slice(0, query.take) : found;
  } } } },
  '@/server/permissions/authz': { requireOrganisation: async () => ({ organisation: { id: 'org-a' } }) },
  '@/lib/utils/handlers': { withErrorHandling: (fn: any) => fn() },
  '@/lib/utils/http': { jsonResponse },
};
const output = ts.transpileModule(fs.readFileSync('src/pages/api/automation-jobs/queue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox: any = { exports: {}, require: (name: string) => { assert.ok(modules[name], name); return modules[name]; } };
vm.runInNewContext(output, sandbox);
const response = await sandbox.exports.GET({});
const data = await response.json();
assert.equal(data.active.length, 127, 'active queue must not truncate at 100');
assert.equal(new Set(data.active.map((job: any) => job.projectId)).size, 3);
assert.ok(data.active.every((job: any) => job.organisationId === 'org-a' && job.executionAuthorisedAt));
assert.equal(data.recent, undefined, 'queue is not a history list');
assert.ok(data.active.every((job: any) => ['READY', 'CLAIMED', 'IN_PROGRESS'].includes(job.status)));
assert.notEqual(data.active[0].status, 'READY', 'running/starting jobs precede waiting work');
assert.equal(requests[0].orderBy[0].executionAuthorisedAt, 'asc');
assert.match(response.headers.get('cache-control'), /no-store/);
console.log('Cross-project queue isolation, full active list, order and planning fee validation passed.');
