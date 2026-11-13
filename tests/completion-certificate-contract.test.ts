import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertSafeAutomationSnapshot,
  automationJobSnapshotV2Schema,
  completionCertificateSnapshotSchema,
} from '../src/lib/validation/automation-job';
import { agentCapabilitiesSchema } from '../src/lib/validation/desktop-agent';
import { desktopJobCreateSchema } from '../src/lib/validation/desktop-handoff';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';
import { COMPLETION_FIXED_ANSWERS } from '../src/lib/completion-certificate';

const read = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
const fixture = read('automation-job-v2-completion-certificate.json');
const warrantFixture = read('automation-job-v2-building-warrant.json');

// The completion snapshot is valid and carries no warrant or planning record.
const parsed = automationJobSnapshotV2Schema.parse(fixture);
assert.equal(parsed.metadata.applicationType, 'COMPLETION_CERTIFICATE');
assert.equal(parsed.buildingWarrant, null);
assert.equal(parsed.planning, null);
assert.equal(parsed.preflight.locationPlanStatus, 'NOT_APPLICABLE');
assert.equal(parsed.completionCertificate?.sourceWarrantId, 'warrant_1');
assert.deepEqual(parsed.completionCertificate?.fixedAnswers, COMPLETION_FIXED_ANSWERS);
assert.equal(parsed.completionCertificate?.amendmentDates, '01/06/2026\n09/07/2026');
assert.doesNotThrow(() => assertSafeAutomationSnapshot(fixture));

// Existing snapshots stay valid, with or without the new key.
assert.equal(automationJobSnapshotV2Schema.safeParse(warrantFixture).success, true);
assert.equal(automationJobSnapshotV2Schema.parse(warrantFixture).completionCertificate, undefined);
assert.equal(automationJobSnapshotV2Schema.safeParse({ ...warrantFixture, completionCertificate: null }).success, true);

const section = fixture.completionCertificate;
const invalid = (change: Record<string, unknown>) =>
  completionCertificateSnapshotSchema.safeParse({ ...section, ...change }).success === false;
assert.equal(completionCertificateSnapshotSchema.safeParse(section).success, true);
// Fixed answers are literals: a job cannot carry a different answer.
assert.ok(invalid({ fixedAnswers: { ...section.fixedAnswers, coversAllWork: false } }));
assert.ok(invalid({ fixedAnswers: { ...section.fixedAnswers, actingAs: 'APPLICANT' } }));
// Resolved answers are required.
assert.ok(invalid({ workCompletedDate: null }));
assert.ok(invalid({ warrantReference: '' }));
assert.ok(invalid({ warrantDate: '05/03/2026' }));
assert.ok(invalid({ energyPerformanceCertificate: null }));
assert.ok(invalid({ sourceWarrantId: '' }));
assert.ok(invalid({ amendmentDates: 'x'.repeat(751) }));
assert.ok(invalid({ continuingRequirements: { applies: true, details: 'x'.repeat(751) } }));
// Entries are checked against their own register.
assert.ok(invalid({ constructionCertificates: { accompany: true, entries: section.designCertificates.entries } }));
assert.ok(invalid({ designCertificates: { ...section.designCertificates, entries: section.constructionCertificates.entries } }));
assert.equal(completionCertificateSnapshotSchema.safeParse({
  ...section, amendmentDates: null, relaxation: { applies: false, reference: null, date: null },
  constructionCertificates: { accompany: false, entries: [] },
  designCertificates: { accompaniedWarrant: false, formQRequired: null, entries: [] },
  continuingRequirements: { applies: false, details: null },
}).success, true);

// Agent compatibility.
const capabilities = {
  workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT', 'COMPLETION_CERTIFICATE'],
  snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1], resetContractVersions: [1],
};
assert.equal(agentCapabilitiesSchema.safeParse(capabilities).success, true);
assert.equal(agentCapabilitiesSchema.safeParse({ ...capabilities, workflows: ['SOMETHING_ELSE'] }).success, false);
const job = { type: 'COMPLETION_CERTIFICATE', payloadVersion: 2, dataSnapshot: fixture };
assert.equal(agentSupportsJob({ capabilities } as never, job as never), false, 'a 4.2.17 Agent cannot finish a completion job');
assert.equal(
  agentSupportsJob({ capabilities: { ...capabilities, workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT'] } } as never, job as never),
  false,
  'an older Agent is never offered a completion job',
);
// Completion jobs now run supporting documents and the declaration: older Agents cannot.
assert.equal(agentSupportsJob({ capabilities: { ...capabilities, completionContractVersions: [2] } } as never, job as never), true);
assert.equal(agentSupportsJob({ capabilities: { ...capabilities, completionContractVersions: [1] } } as never, job as never), false);
assert.equal(
  agentSupportsJob({ capabilities: { ...capabilities, workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT'] } } as never,
    { type: 'BUILDING_WARRANT', payloadVersion: 2 } as never),
  true,
  'warrant jobs are unaffected',
);
// Earlier completion snapshots without documents stay valid.
assert.deepEqual(completionCertificateSnapshotSchema.parse(section).documents, []);

// Completion jobs are only created by their own endpoint.
assert.equal(desktopJobCreateSchema.safeParse({ type: 'COMPLETION_CERTIFICATE' }).success, false);

console.log('completion-certificate-contract: ok');
