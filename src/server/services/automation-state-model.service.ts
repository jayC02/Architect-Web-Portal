import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';
import { automationRunState, objectRecord, type RunState } from '@/lib/automation/state-model';

// Append-only versioned records in the existing event journal. No database or
// callback enum changes, and no historical backfill is required.
export const STATE_MODEL_VERSION = 1;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Tx = Prisma.TransactionClient;
type Scope = { organisationId: string; jobId: string };
const eventKey = (scope: Scope, kind: string, identity: unknown) =>
  `state-v1:${kind}:${digest([scope.organisationId, scope.jobId, identity])}`;

async function ownedJob(tx: Tx, scope: Scope) {
  const job = await tx.automationJob.findFirst({ where: { id: scope.jobId, organisationId: scope.organisationId } });
  if (!job) throw new HttpError(404, 'Automation job not found.');
  return job;
}

async function append(tx: Tx, scope: Scope, kind: string, identity: unknown, payload: Record<string, unknown>) {
  const id = eventKey(scope, kind, identity);
  const existing = await tx.automationJobEvent.upsert({
    where: { idempotencyKey: id }, update: {},
    create: { id, organisationId: scope.organisationId, automationJobId: scope.jobId,
      idempotencyKey: id, eventType: `state_model.${kind}`, payload: { version: STATE_MODEL_VERSION, ...payload } as Prisma.InputJsonValue },
  });
  if (existing.organisationId !== scope.organisationId || existing.automationJobId !== scope.jobId) {
    throw new HttpError(409, 'Automation history ownership mismatch.');
  }
  return existing;
}

export async function recordApplicationSnapshot(tx: Tx, scope: Scope) {
  const job = await ownedJob(tx, scope);
  const snapshot = objectRecord(job.dataSnapshot);
  const isV2 = snapshot.snapshotVersion === 2;
  const warrant = job.type === 'BUILDING_WARRANT';
  const record = objectRecord(isV2 ? snapshot[warrant ? 'buildingWarrant' : 'planning'] : snapshot[warrant ? 'buildingWarrantApplication' : 'planningApplication']);
  const candidateId = isV2 ? record.recordId : record.id;
  const metadata = objectRecord(snapshot.metadata);
  const identityMatches = !isV2 || (metadata.jobId === job.id && metadata.projectId === job.projectId
    && metadata.applicationType === job.type && metadata.organisationId === scope.organisationId);
  const conflicting = objectRecord(isV2 ? snapshot[warrant ? 'planning' : 'buildingWarrant'] : snapshot[warrant ? 'planningApplication' : 'buildingWarrantApplication']);
  const applicationQuery = {
    where: { id: typeof candidateId === 'string' ? candidateId : '', organisationId: scope.organisationId, projectId: job.projectId },
    select: { id: true, updatedAt: true } as const,
  };
  const application = identityMatches && !(isV2 ? conflicting.recordId : conflicting.id) && typeof candidateId === 'string'
    ? (warrant ? await tx.buildingWarrantApplication.findFirst(applicationQuery) : await tx.planningApplication.findFirst(applicationQuery)) : null;
  // Unknown/deleted/ambiguous historical application identities remain unlinked.
  const contentHash = digest([job.payloadVersion, job.dataSnapshot, job.documentSnapshot]);
  return append(tx, scope, 'snapshot', contentHash, {
    snapshotId: eventKey(scope, 'snapshot', contentHash), jobId: job.id, projectId: job.projectId,
    applicationId: application?.id ?? null, applicationType: job.type,
    identityStatus: application ? 'VERIFIED' : 'LEGACY_UNLINKED',
    // Do not claim today's mutable revision was the revision used by an old snapshot.
    sourceRevision: job.sourceUpdatedAt?.toISOString() ?? null,
    payloadVersion: job.payloadVersion, snapshotHash: job.snapshotHash, contentHash,
    dataSnapshot: job.dataSnapshot, documentSnapshot: job.documentSnapshot,
  });
}

/** Persist the authorised pointer in the same transaction as authorisation. */
export async function recordAuthorisedSnapshot(tx: Tx, scope: Scope) {
  const job = await ownedJob(tx, scope);
  const snapshot = await recordApplicationSnapshot(tx, scope);
  if (job.executionAuthorisedAt) await append(tx, scope, 'authorisation', job.executionAuthorisedAt.toISOString(), {
    jobId: job.id, snapshotId: snapshot.id, authorisedAt: job.executionAuthorisedAt.toISOString(),
  });
  return snapshot;
}

type ExecutionIdentity = {
  claimedDeviceId: string | null; agentRunId: string | null; claimedAt: Date | null;
  executionAuthorisedAt: Date | null;
};
const executionIdentity = (job: ExecutionIdentity) => job.claimedDeviceId
  ? [job.agentRunId ?? null, job.claimedDeviceId, job.claimedAt?.toISOString() ?? null] : null;

/** Pure read; historical jobs with no journal records use their legacy payload. */
export async function readExecutionSnapshot(tx: Pick<Tx, 'automationJobEvent'>, scope: Scope, job: ExecutionIdentity) {
  const identity = executionIdentity(job);
  let pointer = identity ? await tx.automationJobEvent.findFirst({ where: {
    organisationId: scope.organisationId, automationJobId: scope.jobId,
    idempotencyKey: eventKey(scope, 'run', identity), eventType: 'state_model.run',
  } }) : null;
  if (!pointer && job.executionAuthorisedAt) pointer = await tx.automationJobEvent.findFirst({ where: {
    organisationId: scope.organisationId, automationJobId: scope.jobId,
    idempotencyKey: eventKey(scope, 'authorisation', job.executionAuthorisedAt.toISOString()), eventType: 'state_model.authorisation',
  } });
  if (!pointer) return null;
  const snapshotId = objectRecord(pointer.payload).snapshotId;
  if (typeof snapshotId !== 'string') throw new HttpError(409, 'Execution snapshot identity is invalid.');
  const snapshot = await tx.automationJobEvent.findFirst({ where: {
    organisationId: scope.organisationId, automationJobId: scope.jobId,
    id: snapshotId, eventType: 'state_model.snapshot',
  } });
  if (!snapshot) throw new HttpError(409, 'Execution snapshot is unavailable.');
  return snapshot;
}

/** Caller must hold its existing job/execution transaction boundary. */
export async function recordAutomationOwnership(tx: Tx, scope: Scope, input: {
  reason: string; eventId?: string; state?: RunState; browserSessionId?: string;
} ) {
  const job = await ownedJob(tx, scope);
  const snapshot = await readExecutionSnapshot(tx, scope, job) ?? await recordApplicationSnapshot(tx, scope);
  const runIdentity = executionIdentity(job);
  if (!runIdentity) return { snapshotId: snapshot.id, runId: null };
  const credential = await tx.desktopAccessToken.findFirst({
    where: { id: job.claimedDeviceId!, organisationId: scope.organisationId }, select: { id: true, automationJobId: true },
  });
  if (!credential || (credential.automationJobId && credential.automationJobId !== job.id)) {
    throw new HttpError(409, 'Execution credential does not belong to this job.');
  }
  if (job.claimedByAgentId && !await tx.agentRegistration.findFirst({
    where: { id: job.claimedByAgentId, organisationId: scope.organisationId }, select: { id: true },
  })) throw new HttpError(409, 'Execution agent does not belong to this organisation.');
  const run = await append(tx, scope, 'run', runIdentity, {
    runId: eventKey(scope, 'run', runIdentity), jobId: job.id, snapshotId: snapshot.id,
    agentRunId: job.agentRunId, agentId: job.claimedByAgentId,
    // Installation != connection. No reliable connection-session concept exists yet.
    agentSessionId: null, executionCredentialId: credential.id,
    claimedAt: job.claimedAt?.toISOString() ?? null,
  });
  const state = input.state ?? automationRunState(job.status, job.resultData, job.progressStageState);
  await append(tx, scope, 'run_state', [run.id, input.eventId ?? [input.reason, state, job.updatedAt.toISOString()]], {
    runId: run.id, snapshotId: objectRecord(run.payload).snapshotId, jobId: job.id,
    state, legacyStatus: job.status, reason: input.reason,
    observedAt: new Date().toISOString(), lastCheckpoint: job.lastCheckpoint,
    result: job.resultData, startedAt: job.status === 'IN_PROGRESS' && input.reason === 'started' ? new Date().toISOString() : null,
    finishedAt: ['PREPARED', 'NEEDS_ATTENTION', 'INTERRUPTED', 'FAILED', 'STOPPED'].includes(state ?? '') ? new Date().toISOString() : null,
  });
  if (input.browserSessionId && (!input.browserSessionId.trim() || input.browserSessionId.length > 200)) {
    throw new HttpError(400, 'Invalid retained browser identity.');
  }
  if (input.browserSessionId) {
    // Scoped by run: Selenium identifiers are not globally unique or credentials.
    await append(tx, scope, 'browser', [run.id, input.browserSessionId], {
      browserSessionId: input.browserSessionId, runId: run.id, jobId: job.id,
      agentId: job.claimedByAgentId, agentSessionId: null,
      executionCredentialId: credential.id, status: 'RETAINED_AT_HANDOFF',
      observedAt: new Date().toISOString(), releasedAt: null,
    });
  }
  return { snapshotId: objectRecord(run.payload).snapshotId as string, runId: run.id };
}

export async function readAutomationHistory(tx: Pick<Tx, 'automationJob' | 'automationJobEvent'>, scope: Scope) {
  if (!await tx.automationJob.findFirst({ where: { id: scope.jobId, organisationId: scope.organisationId }, select: { id: true } })) {
    throw new HttpError(404, 'Automation job not found.');
  }
  return tx.automationJobEvent.findMany({
    where: { organisationId: scope.organisationId, automationJobId: scope.jobId, eventType: { startsWith: 'state_model.' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}
