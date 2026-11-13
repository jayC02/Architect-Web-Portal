import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/utils/http';
import {
  queueCompletionCertificateJob,
  saveCompletionPreparation,
} from '../src/server/services/completion-certificate.service';
import { completionDatabase, completePreparation } from './helpers/completion-certificate-database';

const today = new Date('2026-11-11T12:00:00.000Z');
const user = { id: 'user', name: 'Fixture User', email: 'fixture@example.com' };
const queueInput = { organisationId: 'org', organisationName: 'Fixture Practice', warrantId: 'warrant_1', user, today };
const authoriser = (state: { jobs: any[] }, compatibleAgentOnline = true) => {
  const calls: string[] = [];
  return {
    calls,
    authorise: async ({ jobId }: { organisationId: string; jobId: string }) => {
      calls.push(jobId);
      state.jobs.find((job) => job.id === jobId).executionAuthorisedAt = new Date('2026-11-11T12:00:01.000Z');
      return { compatibleAgentOnline };
    },
  };
};

// Saving completion answers leaves the original warrant application alone.
{
  const { database, state } = completionDatabase();
  const before = structuredClone({
    preparationData: state.warrant.preparationData, status: state.warrant.status, description: state.warrant.description,
    warrantReference: state.warrant.warrantReference, completionCertificateStatus: state.warrant.completionCertificateStatus,
  });
  const saved = await saveCompletionPreparation(
    { organisationId: 'org', warrantId: 'warrant_1', body: { ...completePreparation, warrantReference: '26/09999/WARR' }, today },
    database as never,
  );
  assert.deepEqual(saved.issues, []);
  assert.equal(saved.preparation.warrantReference, '26/09999/WARR');
  assert.equal((state.warrant.completionPreparationData as any).workCompletedDate, '2026-10-30');
  assert.ok(state.warrant.completionPreparedAt instanceof Date);
  assert.deepEqual(state.warrant.preparationData, before.preparationData);
  assert.equal(state.warrant.status, before.status);
  assert.equal(state.warrant.description, before.description);
  assert.equal(state.warrant.warrantReference, before.warrantReference, 'a corrected reference is stored with the completion answers only');
  assert.equal(state.warrant.completionCertificateStatus, before.completionCertificateStatus);

  // Reopening returns what was saved, not the prefill.
  const reopened = await saveCompletionPreparation(
    { organisationId: 'org', warrantId: 'warrant_1', body: state.warrant.completionPreparationData, today }, database as never,
  );
  assert.equal(reopened.preparation.warrantReference, '26/09999/WARR');
}

// A partial save is kept and reports what is missing.
{
  const { database, state } = completionDatabase();
  const saved = await saveCompletionPreparation(
    { organisationId: 'org', warrantId: 'warrant_1', body: { workCompletedDate: '2026-10-30' }, today }, database as never,
  );
  assert.equal((state.warrant.completionPreparationData as any).workCompletedDate, '2026-10-30');
  assert.ok(saved.issues.some((issue) => issue.field === 'continuingRequirements.applies'));
  assert.ok(!saved.issues.some((issue) => issue.field === 'workCompletedDate'));
}

// Invalid input is rejected and nothing is written.
{
  const { database, state } = completionDatabase();
  await assert.rejects(
    () => saveCompletionPreparation({ organisationId: 'org', warrantId: 'warrant_1', body: { amendmentDates: 'x'.repeat(751) }, today }, database as never),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () => saveCompletionPreparation({ organisationId: 'other-org', warrantId: 'warrant_1', body: completePreparation, today }, database as never),
    (error) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(state.warrant.completionPreparationData, null);
}

// Queueing creates one authorised job; a second request returns the same job.
{
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation });
  const warrantStatus = state.warrant.status;
  const { authorise, calls } = authoriser(state);
  const first = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  const second = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.jobId, first.jobId, 'a double-click queues one job');
  assert.equal(state.jobs.length, 1);
  assert.deepEqual(calls, [first.jobId], 'an already authorised job is not authorised again');
  assert.equal(first.compatibleAgentOnline, true);

  const job = state.jobs[0];
  assert.equal(job.type, 'COMPLETION_CERTIFICATE');
  assert.equal(job.status, 'READY');
  assert.equal(job.payloadVersion, 2);
  assert.equal(job.organisationId, 'org');
  assert.equal(job.projectId, 'project');
  assert.equal(job.createdById, 'user');
  assert.equal(job.title, 'Completion Certificate - 112 Ralston Avenue');
  assert.equal(job.dataSnapshot.metadata.jobId, job.id);
  assert.equal(job.dataSnapshot.completionCertificate.sourceWarrantId, 'warrant_1');
  assert.ok(job.executionAuthorisedAt);
  assert.equal(state.warrant.completionCertificateStatus, 'DRAFTING');
  assert.equal(state.warrant.status, warrantStatus, 'the warrant status is untouched');
}

// A READY job that was never authorised (interrupted request) is authorised on the next request.
{
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation });
  const failing = { authorise: async () => { throw new Error('network'); } };
  await assert.rejects(() => queueCompletionCertificateJob(queueInput, { database: database as never, ...failing }));
  assert.equal(state.jobs.length, 1);
  const { authorise, calls } = authoriser(state, false);
  const retry = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  assert.equal(retry.created, false);
  assert.equal(state.jobs.length, 1);
  assert.deepEqual(calls, [retry.jobId]);
  assert.equal(retry.compatibleAgentOnline, false);
}

// A finished attempt does not block a fresh run with the current answers.
{
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation });
  const { authorise } = authoriser(state);
  const first = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  state.jobs[0].status = 'AWAITING_PORTAL_REVIEW';
  const rerun = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  assert.equal(rerun.created, true);
  assert.notEqual(rerun.jobId, first.jobId);
  // A running attempt does.
  state.jobs[1].status = 'IN_PROGRESS';
  const during = await queueCompletionCertificateJob(queueInput, { database: database as never, authorise });
  assert.equal(during.created, false);
  assert.equal(during.jobId, rerun.jobId);
}

// Incomplete answers never queue.
{
  const { database, state } = completionDatabase({ completionPreparationData: { ...completePreparation, workCompletedDate: null } });
  const { authorise, calls } = authoriser(state);
  await assert.rejects(
    () => queueCompletionCertificateJob(queueInput, { database: database as never, authorise }),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(state.jobs.length, 0);
  assert.deepEqual(calls, []);
  assert.equal(state.warrant.completionCertificateStatus, 'NOT_STARTED');
}

// A later completion status is never moved back to Drafting.
for (const status of ['SUBMITTED', 'ACCEPTED', 'REJECTED']) {
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation, completionCertificateStatus: status });
  await queueCompletionCertificateJob(queueInput, { database: database as never, authorise: authoriser(state).authorise });
  assert.equal(state.warrant.completionCertificateStatus, status);
}
{
  const { database, state } = completionDatabase({ completionPreparationData: completePreparation, completionCertificateStatus: 'NOT_REQUIRED' });
  await queueCompletionCertificateJob(queueInput, { database: database as never, authorise: authoriser(state).authorise });
  assert.equal(state.warrant.completionCertificateStatus, 'DRAFTING');
}

console.log('completion-certificate-queue: ok');
