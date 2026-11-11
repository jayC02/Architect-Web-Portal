import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  automationJobApplicationId,
  resolveAutomationJobIdentity,
  selectCurrentAutomationJob,
} from '../src/server/services/desktop-automation-status.service';

const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-completion-certificate.json', 'utf8'));
const warrantFixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
const snapshot = (change: Record<string, unknown> = {}) => ({
  ...fixture, metadata: { ...fixture.metadata, jobId: 'job_12345678', projectId: 'project' }, ...change,
});
const job = (dataSnapshot: unknown = snapshot()) => ({
  id: 'job_12345678', projectId: 'project', type: 'COMPLETION_CERTIFICATE', status: 'READY', dataSnapshot,
  documentSnapshot: {}, claimedAt: null, preparedAt: new Date('2026-11-11'), updatedAt: new Date('2026-11-11'), createdAt: new Date('2026-11-11'),
});

const identity = resolveAutomationJobIdentity(job() as never);
assert.deepEqual(identity, {
  jobId: 'job_12345678', projectId: 'project', applicationType: 'COMPLETION_CERTIFICATE',
  applicationId: 'warrant_1', snapshotVersion: 2,
});
assert.equal(automationJobApplicationId(job() as never), 'warrant_1');

// A completion job must not also name a warrant or planning record.
assert.throws(() => resolveAutomationJobIdentity(job(snapshot({ buildingWarrant: { recordId: 'warrant_1' } })) as never));
assert.throws(() => resolveAutomationJobIdentity(job(snapshot({ planning: { recordId: 'planning_1' } })) as never));
assert.throws(() => resolveAutomationJobIdentity(job(snapshot({ completionCertificate: null })) as never));
assert.throws(() => resolveAutomationJobIdentity(job(snapshot({ completionCertificate: { ...fixture.completionCertificate, sourceWarrantId: '' } })) as never));
// Identity must match the job row.
assert.throws(() => resolveAutomationJobIdentity({ ...job(), id: 'another_job_id' } as never));
// There is no legacy (v1) completion job.
assert.throws(() => resolveAutomationJobIdentity(job({ schemaVersion: 1, buildingWarrantApplication: { id: 'warrant_1' } }) as never));

// A completion job is never the warrant's current run, and the reverse.
const warrantJob = {
  ...job({ ...warrantFixture, metadata: { ...warrantFixture.metadata, jobId: 'job_warrant_1', projectId: 'project' },
    buildingWarrant: { ...warrantFixture.buildingWarrant, recordId: 'warrant_1' } }),
  id: 'job_warrant_1', type: 'BUILDING_WARRANT',
};
const jobs = [job(), warrantJob];
assert.equal(selectCurrentAutomationJob(jobs as never, { projectId: 'project', types: ['BUILDING_WARRANT'] as never, applicationId: 'warrant_1' })?.id, 'job_warrant_1');
assert.equal(selectCurrentAutomationJob(jobs as never, { projectId: 'project', types: ['COMPLETION_CERTIFICATE'] as never, applicationId: 'warrant_1' })?.id, 'job_12345678');
assert.equal(selectCurrentAutomationJob([job()] as never, { projectId: 'project', types: ['BUILDING_WARRANT'] as never, applicationId: 'warrant_1' }), null);
assert.equal(selectCurrentAutomationJob([job()] as never, { projectId: 'project', types: ['COMPLETION_CERTIFICATE'] as never, applicationId: 'another_warrant' }), null);

console.log('completion-certificate-identity: ok');
