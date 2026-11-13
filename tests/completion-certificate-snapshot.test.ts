import assert from 'node:assert/strict';
import { automationJobSnapshotV2Schema } from '../src/lib/validation/automation-job';
import { COMPLETION_FIXED_ANSWERS } from '../src/lib/completion-certificate';
import { HttpError } from '../src/lib/utils/http';
import {
  buildCompletionCertificateSnapshot,
  completionPreparationFor,
  loadCompletionContext,
} from '../src/server/services/completion-certificate.service';
import { completionDatabase, completePreparation } from './helpers/completion-certificate-database';

const today = new Date('2026-11-11T12:00:00.000Z');
const input = {
  jobId: 'job_12345678', createdAt: today, organisationId: 'org', organisationName: 'Fixture Practice',
  warrantId: 'warrant_1', createdBy: { id: 'user', name: 'Fixture User', email: 'fixture@example.com' },
};

// Context and prefill: nothing saved yet.
{
  const { database } = completionDatabase();
  const context = await loadCompletionContext({ organisationId: 'org', warrantId: 'warrant_1' }, database as never);
  const { preparation, issues, parties } = completionPreparationFor(context, today);
  assert.equal(preparation.warrantReference, '26/01234/WARR');
  assert.equal(preparation.warrantDate, '2026-03-05');
  assert.equal(preparation.amendmentDates, '01/06/2026', 'only granted amendments on this project are listed');
  assert.equal(preparation.workCompletedDate, null);
  assert.ok(issues.some((issue) => issue.field === 'workCompletedDate'));
  assert.equal(parties.client?.firstName, 'Sam');
  assert.equal(parties.agent.firstName, 'Alex');
  assert.ok(context.documents.some((item) => item.id === 'doc_1' && item.name === 'Certificate of construction.pdf'));
}

// A warrant in another organisation is not found.
{
  const { database } = completionDatabase();
  await assert.rejects(
    () => loadCompletionContext({ organisationId: 'other-org', warrantId: 'warrant_1' }, database as never),
    (error) => error instanceof HttpError && error.status === 404,
  );
}

// A complete preparation builds a valid, ready snapshot.
{
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation });
  const built = await buildCompletionCertificateSnapshot(input, database as never, today);
  const snapshot = built.dataSnapshot;
  assert.equal(automationJobSnapshotV2Schema.safeParse(snapshot).success, true);
  assert.equal(built.title, 'Completion Certificate - 112 Ralston Avenue');
  assert.equal(snapshot.metadata.applicationType, 'COMPLETION_CERTIFICATE');
  assert.equal(snapshot.metadata.jobId, 'job_12345678');
  assert.equal(snapshot.metadata.projectId, 'project');
  assert.equal(snapshot.metadata.sourceType, 'WARRANT_RECORD');
  assert.equal(snapshot.buildingWarrant, null);
  assert.equal(snapshot.planning, null);
  assert.deepEqual(snapshot.documents, []);
  assert.deepEqual(built.documentSnapshot, { schemaVersion: 2, documents: [] });
  assert.equal(built.preflight.status, 'READY');
  assert.equal(snapshot.preflight.locationPlanStatus, 'NOT_APPLICABLE');
  assert.match(built.snapshotHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.metadata.integrity, built.snapshotHash);

  const completion = snapshot.completionCertificate!;
  assert.equal(completion.sourceWarrantId, 'warrant_1');
  assert.equal(completion.proposalHint.proposalName, '112 Ralston Avenue, Glasgow, G52 3NB');
  assert.equal(completion.workCompletedDate, '2026-10-30');
  assert.equal(completion.warrantReference, '26/01234/WARR');
  assert.deepEqual(completion.fixedAnswers, COMPLETION_FIXED_ANSWERS);
  assert.equal(completion.constructionCertificates.entries[0].certifierRegistration.part1, 'SEL1');
  assert.equal(completion.designCertificates.formQRequired, true);

  // The relevant person is the client; the agent comes from organisation defaults.
  assert.equal(snapshot.applicant.firstName, 'Sam');
  assert.equal(snapshot.applicant.applicantIsOwner, true);
  assert.equal(snapshot.applicant.source, 'CLIENT');
  assert.equal(snapshot.organisation.agent.firstName, 'Alex');
  assert.equal(snapshot.site.address.addressLine1, '112 Ralston Avenue');

  // Source revision follows the newest of warrant, project, client, site and defaults.
  assert.equal(built.sourceUpdatedAt.toISOString(), '2026-11-10T09:00:00.000Z');
  state.warrant.updatedAt = new Date('2026-11-11T08:00:00.000Z');
  const rebuilt = await buildCompletionCertificateSnapshot(input, database as never, today);
  assert.equal(rebuilt.sourceUpdatedAt.toISOString(), '2026-11-11T08:00:00.000Z');
  assert.notEqual(rebuilt.snapshotHash, built.snapshotHash);
}

// Answers that do not apply are cleared rather than sent.
{
  const { database } = completionDatabase({
    completionPreparationData: {
      ...completePreparation,
      relaxation: { applies: false, reference: 'stale', date: '2026-02-01' },
      // No certificate uploaded: the certificate answers are No and their entries are not sent.
      documents: completePreparation.documents.filter((item) => item.role !== 'CONSTRUCTION_CERTIFICATE'),
      constructionCertificates: { ...completePreparation.constructionCertificates, accompany: false },
      designCertificates: { ...completePreparation.designCertificates, accompaniedWarrant: false },
      continuingRequirements: { applies: false, details: 'stale' },
    },
  });
  const completion = (await buildCompletionCertificateSnapshot(input, database as never, today)).dataSnapshot.completionCertificate!;
  assert.deepEqual(completion.relaxation, { applies: false, reference: null, date: null });
  assert.deepEqual(completion.constructionCertificates, { accompany: false, entries: [] });
  assert.deepEqual(completion.designCertificates, { accompaniedWarrant: false, formQRequired: null, entries: [] });
  assert.deepEqual(completion.continuingRequirements, { applies: false, details: null });
}

// Incomplete answers never become a job snapshot.
{
  const { database } = completionDatabase({ completionPreparationData: { ...completePreparation, workCompletedDate: null } });
  await assert.rejects(
    () => buildCompletionCertificateSnapshot(input, database as never, today),
    (error) => error instanceof HttpError && error.status === 409,
  );
}
{
  const { database } = completionDatabase({ completionPreparationData: completePreparation, client: null });
  await assert.rejects(
    () => buildCompletionCertificateSnapshot(input, database as never, today),
    (error) => error instanceof HttpError && error.status === 409,
  );
}

console.log('completion-certificate-snapshot: ok');
