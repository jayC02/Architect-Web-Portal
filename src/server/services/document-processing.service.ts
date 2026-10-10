import { databaseTable } from '@/lib/db/table';
import { createHash, randomUUID } from 'node:crypto';
import { ApplicationDraftDocumentStatus, ApplicationDraftStatus, Prisma, type DocumentProcessingJob } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { HttpError } from '@/lib/utils/http';
import { PROCESSING_ATTEMPTS, PROCESSING_LEASE_MS, PROCESSING_WORKER_BUDGET_MS, processingEnabled, processingRetryDelay, leaseIsCurrent } from '@/lib/document-processing';
import { getApplicationDraftForOrganisation, prepareApplicationDraft, persistSuggestion } from './application-draft.service';
import { classifyProjectDocumentBatch, DOCUMENT_ANALYSIS_VERSION, DOCUMENT_ANALYSIS_PROMPT_VERSION, DOCUMENT_ANALYSIS_SCHEMA_VERSION, configuredDocumentAnalysisIdentity, classificationAuditForSuggestion, analysisStatusForSuggestion } from './pdf-classification.service';
import { retryDatabaseTransaction } from './transaction-retry';

const version = `${DOCUMENT_ANALYSIS_VERSION}:${DOCUMENT_ANALYSIS_PROMPT_VERSION}:${DOCUMENT_ANALYSIS_SCHEMA_VERSION}`;
const terminalDraft = ['COMMITTED', 'COMMITTING', 'CANCELLED', 'EXPIRED'];

export async function enqueueDraftProcessing(draftId: string, organisationId: string, options: { force?: boolean } = {}) {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (terminalDraft.includes(draft.status) || draft.expiresAt <= new Date()) throw new HttpError(409, 'This draft cannot be analysed.');
  if (!draft.documents.length || draft.documents.some(document => document.uploadStatus !== 'READY')) throw new HttpError(409, 'Finish uploading each document before analysis.');
  const identity = configuredDocumentAnalysisIdentity();
  const pending = draft.documents.filter(document => !(document.analysisStatus === 'SUCCESS'
    && document.analysisProvider === identity.provider && document.analysisModel === identity.model && document.analysisResult !== null
    && document.analysisVersion === DOCUMENT_ANALYSIS_VERSION && document.analysisPromptVersion === DOCUMENT_ANALYSIS_PROMPT_VERSION
    && document.analysisSchemaVersion === DOCUMENT_ANALYSIS_SCHEMA_VERSION));
  const entries = pending.map(document => ({ document, idempotencyKey: createHash('sha256').update(`${organisationId}:${document.id}:${document.sha256}:${version}`).digest('hex') }));
  await prisma.$transaction(async tx => {
    const changed = await tx.applicationDraft.updateMany({ where: { id: draftId, organisationId, documentSetRevision: draft.documentSetRevision, status: { notIn: [ApplicationDraftStatus.COMMITTED, ApplicationDraftStatus.COMMITTING, ApplicationDraftStatus.CANCELLED, ApplicationDraftStatus.EXPIRED] } }, data: { status: 'ANALYSING', analysisSummary: { phase: 'processing', completed: draft.documents.length - pending.length, total: draft.documents.length, message: processingEnabled() ? 'Documents queued for analysis.' : 'Analysing uploaded documents. Completed results are saved.' } } });
    if (!changed.count) throw new HttpError(409, 'The document set changed. Reload and retry.');
    // Bulk reservation keeps a 20-PDF package within the request/transaction budget.
    const jobs = await tx.documentProcessingJob.findMany({ where: { idempotencyKey: { in: entries.map(entry => entry.idempotencyKey) } } });
    const existing = new Map(jobs.map(job => [job.idempotencyKey, job]));
    const fresh = entries.filter(entry => !existing.has(entry.idempotencyKey));
    if (fresh.length) await tx.documentProcessingJob.createMany({ data: fresh.map(({ document, idempotencyKey }) => ({ organisationId, draftId, draftDocumentId: document.id, idempotencyKey, processingVersion: version, documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision })) });
    const resettable = jobs.filter(job => ['SUCCEEDED', 'CANCELLED'].includes(job.state) || (options.force && job.state === 'FAILED'));
    if (resettable.length) await tx.documentProcessingJob.updateMany({ where: { id: { in: resettable.map(job => job.id) }, state: { in: ['SUCCEEDED', 'CANCELLED', 'FAILED'] } }, data: { state: 'WAITING', attempts: 0, nextAttemptAt: new Date(), completedAt: null, failureCode: null, failureMessage: null, leaseOwner: null, leaseExpiresAt: null, documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision } });
    const pendingIds = [...fresh.map(entry => entry.document.id), ...resettable.flatMap(job => job.draftDocumentId ? [job.draftDocumentId] : [])];
    if (pendingIds.length) await tx.applicationDraftDocument.updateMany({ where: { id: { in: pendingIds }, draftId, cancelledAt: null }, data: { analysisStatus: 'PENDING', analysisError: null } });
    // A deliberate retry never resets a live preparation lease.
    if (options.force || draft.status !== 'ANALYSING') await tx.documentProcessingJob.updateMany({ where: { draftId, organisationId, kind: 'PREPARE', documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision, state: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } }, data: { state: 'WAITING', attempts: 0, nextAttemptAt: new Date(), completedAt: null, failureCode: null, failureMessage: null } });
  }, { timeout: 30_000 });
  await enqueuePreparedReview(draftId, organisationId);
}

export async function enqueueProjectDocumentProcessing(projectDocumentId: string, organisationId: string, options: { retry?: boolean } = {}) {
  if (!processingEnabled()) {
    if (options.retry) throw new HttpError(503, 'Background processing is awaiting worker configuration. Your file is safe.');
    return;
  }
  const document = await prisma.projectDocument.findFirst({ where: { id: projectDocumentId, organisationId } });
  if (!document) {
    if (options.retry) throw new HttpError(404, 'Document not found.');
    return;
  }
  const idempotencyKey = createHash('sha256').update(`${organisationId}:${document.id}:${document.fileHash}:${version}`).digest('hex');
  return prisma.$transaction(async tx => {
    const job = await tx.documentProcessingJob.upsert({ where: { idempotencyKey }, create: { organisationId, projectDocumentId, idempotencyKey, processingVersion: version }, update: {} });
    if (options.retry && job.state === 'FAILED') {
      // Only exhausted work is reset. Duplicate clicks cannot reset a live lease
      // or repeat a successful analysis, and the document identity stays fixed.
      const reset = await tx.documentProcessingJob.updateMany({ where: { id: job.id, state: 'FAILED' }, data: { state: 'WAITING', attempts: 0, nextAttemptAt: new Date(), completedAt: null, failureCode: null, failureMessage: null, leaseOwner: null, leaseExpiresAt: null, leaseGeneration: { increment: 1 } } });
      if (reset.count) await tx.projectDocument.updateMany({ where: { id: projectDocumentId, organisationId }, data: { analysisStatus: 'PENDING' } });
    }
    return tx.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
  });
}

async function enqueuePreparedReview(draftId: string, organisationId: string) {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (draft.status !== 'ANALYSING') return;
  const active = await prisma.documentProcessingJob.count({ where: { draftId, organisationId, kind: 'DOCUMENT', state: { in: ['WAITING', 'RUNNING', 'RETRYING'] } } });
  if (active) return;
  const idempotencyKey = `prepare:${draftId}:${draft.documentSetRevision}:${draft.reviewRevision}:${version}`;
  await prisma.documentProcessingJob.upsert({ where: { idempotencyKey }, create: { organisationId, draftId, kind: 'PREPARE', idempotencyKey, processingVersion: version, documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision }, update: {} });
}

export async function claimProcessingJob(owner: string, organisationId?: string, options: { draftId?: string; leaseMs?: number } = {}) {
  // Organisation locking prevents two workers from both observing an empty slot.
  const candidates = await prisma.documentProcessingJob.findMany({ where: { ...(organisationId ? { organisationId } : {}), ...(options.draftId ? { draftId: options.draftId } : {}), OR: [{ state: { in: ['WAITING', 'RETRYING'] }, nextAttemptAt: { lte: new Date() } }, { state: 'RUNNING', leaseExpiresAt: { lte: new Date() } }] }, select: { organisationId: true }, distinct: ['organisationId'], take: 20, orderBy: { nextAttemptAt: 'asc' } });
  for (const candidate of candidates) {
    const claimed = await retryDatabaseTransaction(() => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ${databaseTable('Organisation')} WHERE id = ${candidate.organisationId} FOR UPDATE`;
      const now = new Date();
      const active = await tx.documentProcessingJob.count({ where: { organisationId: candidate.organisationId, state: 'RUNNING', leaseExpiresAt: { gt: now } } });
      if (active >= 2) return null;
      const [job] = await tx.$queryRaw<DocumentProcessingJob[]>`SELECT * FROM ${databaseTable('DocumentProcessingJob')} WHERE "organisationId" = ${candidate.organisationId}
        AND (${options.draftId ?? null}::text IS NULL OR "draftId" = ${options.draftId ?? null})
        AND (("state" IN ('WAITING', 'RETRYING') AND "nextAttemptAt" <= ${now}) OR ("state" = 'RUNNING' AND "leaseExpiresAt" <= ${now}))
        ORDER BY "nextAttemptAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!job) return null;
      if (job.attempts >= PROCESSING_ATTEMPTS) {
        await tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: 'FAILED', failureCode: 'ATTEMPTS_EXHAUSTED', failureMessage: 'Processing stopped after five attempts. Retry analysis or classify manually.', leaseOwner: null, leaseExpiresAt: null } });
        if (job.draftDocumentId) await tx.applicationDraftDocument.updateMany({ where: { id: job.draftDocumentId, cancelledAt: null, analysisStatus: { not: 'SUCCESS' } }, data: { analysisStatus: 'FAILED', analysisError: 'Processing interrupted repeatedly. Retry analysis or classify manually.' } });
        if (job.projectDocumentId) await tx.projectDocument.updateMany({ where: { id: job.projectDocumentId, organisationId: job.organisationId }, data: { analysisStatus: 'FAILED' } });
        return null;
      }
      return tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: 'RUNNING', attempts: { increment: 1 }, leaseGeneration: { increment: 1 }, leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + (options.leaseMs ?? PROCESSING_LEASE_MS)) } });
    }));
    if (claimed) return claimed;
  }
  return null;
}

export async function fencedProcessingWrite(job: DocumentProcessingJob, write: (tx: Prisma.TransactionClient) => Promise<void>) {
  return prisma.$transaction(async tx => {
    const [current] = await tx.$queryRaw<DocumentProcessingJob[]>`SELECT * FROM ${databaseTable('DocumentProcessingJob')} WHERE id = ${job.id} FOR UPDATE`;
    if (!current || !leaseIsCurrent(current, job.leaseOwner!, job.leaseGeneration)) return false;
    await write(tx);
    await tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: 'SUCCEEDED', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, failureCode: null, failureMessage: null } });
    return true;
  });
}

async function processClaim(job: DocumentProcessingJob, signal?: AbortSignal) {
  if (job.kind === 'PREPARE') {
    await prepareApplicationDraft(job.draftId!, job.organisationId, { job });
    return;
  }
  const draftDocument = job.draftDocumentId ? await prisma.applicationDraftDocument.findFirst({ where: { id: job.draftDocumentId, cancelledAt: null, draft: { organisationId: job.organisationId, status: { notIn: [ApplicationDraftStatus.COMMITTED, ApplicationDraftStatus.COMMITTING, ApplicationDraftStatus.CANCELLED, ApplicationDraftStatus.EXPIRED] } } } }) : null;
  const projectDocument = job.projectDocumentId ? await prisma.projectDocument.findFirst({ where: { id: job.projectDocumentId, organisationId: job.organisationId } }) : null;
  const document = draftDocument ?? projectDocument;
  if (!document) { await fencedProcessingWrite(job, async () => {}); return; }
  if (draftDocument?.sha256) {
    const identity = configuredDocumentAnalysisIdentity();
    const cacheIdentity = { analysisVersion: DOCUMENT_ANALYSIS_VERSION, analysisProvider: identity.provider, analysisModel: identity.model, analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION, analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION, analysisStatus: 'SUCCESS' as const, analysisResult: { not: Prisma.JsonNull } };
    const cachedDraft = await prisma.applicationDraftDocument.findFirst({ where: { ...cacheIdentity, id: { not: draftDocument.id }, sha256: draftDocument.sha256, cancelledAt: null, draft: { organisationId: job.organisationId } }, orderBy: { updatedAt: 'desc' } });
    const cachedProject = cachedDraft ? null : await prisma.projectDocument.findFirst({ where: { ...cacheIdentity, organisationId: job.organisationId, fileHash: draftDocument.sha256 }, orderBy: { analysedAt: 'desc' } });
    const cached = cachedDraft ?? cachedProject;
    if (cached) {
      await fencedProcessingWrite(job, async tx => {
        const current = await tx.applicationDraftDocument.findFirst({ where: { id: draftDocument.id, cancelledAt: null, draft: { organisationId: job.organisationId, status: { notIn: ['COMMITTED', 'COMMITTING', 'CANCELLED', 'EXPIRED'] } } } });
        if (!current) return;
        await tx.applicationDraftDocument.update({ where: { id: current.id }, data: {
          ...cacheIdentity, analysisResult: cached.analysisResult as Prisma.InputJsonValue, analysisError: null,
          ...(current.classificationSource === 'MANUAL' ? {} : {
            documentType: cachedDraft ? cachedDraft.documentType : cachedProject!.type,
            revision: cached.revision, drawingNumber: cached.drawingNumber, drawingTitle: cached.drawingTitle,
            classificationSource: cachedDraft?.classificationSource ?? cachedProject?.sortSource,
            confidence: cachedDraft?.confidence ?? cachedProject?.sortConfidence,
            classificationReason: cachedDraft?.classificationReason ?? cachedProject?.sortReason,
          }),
        } });
      });
      return;
    }
  }
  const bytes = await readStoredDocumentBytes(document.storageKey, 'storageUrl' in document ? document.storageUrl : undefined);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expectedHash = draftDocument?.sha256 ?? projectDocument?.fileHash;
  if (expectedHash && expectedHash !== sha256) throw new HttpError(400, 'Document integrity failed.');
  const draft = draftDocument ? await getApplicationDraftForOrganisation(draftDocument.draftId, job.organisationId) : null;
  const [suggestion] = await classifyProjectDocumentBatch([{ documentId: document.id, filename: draftDocument?.originalFilename ?? projectDocument!.originalName, mimeType: document.mimeType, bytes }], { applicationType: draft?.selectedApplicationType && draft.selectedApplicationType !== 'AUTO' ? draft.selectedApplicationType : undefined, projectNotes: draft?.notes ?? undefined }, undefined, undefined, signal);
  const status = suggestion.classificationDetails?.aiStatus;
  if (signal?.aborted || (status === 'provider_unavailable' && configuredDocumentAnalysisIdentity().provider !== 'deterministic' && suggestion.classificationDetails?.providerHttpStatus !== 401 && suggestion.classificationDetails?.providerHttpStatus !== 403)) throw new HttpError(503, 'Document provider temporarily unavailable.');
  await fencedProcessingWrite(job, async tx => {
    if (draftDocument) {
      await tx.$queryRaw`SELECT id FROM ${databaseTable('ApplicationDraft')} WHERE id = ${draftDocument.draftId} FOR UPDATE`;
      const currentDraft = await tx.applicationDraft.findFirst({ where: { id: draftDocument.draftId, organisationId: job.organisationId, status: { notIn: ['COMMITTED', 'COMMITTING', 'CANCELLED', 'EXPIRED'] } } });
      if (!currentDraft) return;
      const currentDocument = await tx.applicationDraftDocument.findFirst({ where: { id: draftDocument.id, cancelledAt: null } });
      if (!currentDocument) return;
      // Store reusable evidence even if another document was added. Only the
      // revision-fenced PREPARE job may change the architect's confirmed review.
      await persistSuggestion(currentDocument, suggestion, configuredDocumentAnalysisIdentity(), tx);
    } else if (projectDocument) {
      // A manually classified document keeps its explicit classification.
      const audit = classificationAuditForSuggestion(suggestion);
      await tx.projectDocument.updateMany({ where: { id: projectDocument.id, organisationId: job.organisationId }, data: {
        analysisResult: audit as Prisma.InputJsonValue, analysisVersion: DOCUMENT_ANALYSIS_VERSION,
        analysisProvider: suggestion.classificationDetails?.provider ?? configuredDocumentAnalysisIdentity().provider,
        analysisModel: suggestion.classificationDetails?.model ?? configuredDocumentAnalysisIdentity().model,
        analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION, analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        analysisStatus: analysisStatusForSuggestion(suggestion), analysedAt: new Date(),
      } });
      await tx.projectDocument.updateMany({ where: { id: projectDocument.id, organisationId: job.organisationId, OR: [{ sortSource: null }, { sortSource: { not: 'MANUAL' } }] }, data: {
        type: suggestion.suggestedDocumentType, sortSource: suggestion.source, sortConfidence: suggestion.confidence,
        sortReason: suggestion.reason, revision: suggestion.revision, drawingNumber: suggestion.drawingNumber, drawingTitle: suggestion.drawingTitle,
      } });
    }
  });
}

export async function runDocumentProcessingWorker(organisationId?: string) {
  if (!processingEnabled()) return { processed: 0, skipped: true };
  return runProcessingJobs(organisationId);
}

// Awaited request work: no waitUntil, cron, or scheduled worker is required.
// Stop claiming with enough time left for an entire bounded provider operation.
async function runProcessingJobs(organisationId?: string, inline?: { draftId: string; maxJobs?: number; deadline?: number }) {
  const owner = randomUUID();
  const deadline = inline?.deadline ?? Date.now() + (inline ? 180_000 : PROCESSING_WORKER_BUDGET_MS);
  let processed = 0;
  while (Date.now() + (inline ? 110_000 : PROCESSING_LEASE_MS) < deadline && processed < (inline?.maxJobs ?? 4)) {
    const job = await claimProcessingJob(owner, organisationId, inline ? { draftId: inline.draftId, leaseMs: 120_000 } : {});
    if (!job) break;
    try { await processClaim(job, inline ? AbortSignal.timeout(80_000) : undefined); }
    catch (error) {
      const transient = !(error instanceof HttpError) || [408, 429, 503, 500, 502, 504].includes(error.status);
      const retry = transient && job.attempts < PROCESSING_ATTEMPTS;
      await prisma.$transaction(async tx => {
        const [current] = await tx.$queryRaw<DocumentProcessingJob[]>`SELECT * FROM ${databaseTable('DocumentProcessingJob')} WHERE id = ${job.id} FOR UPDATE`;
        if (!current || !leaseIsCurrent(current, owner, job.leaseGeneration)) return;
        await tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: retry ? 'RETRYING' : 'FAILED', nextAttemptAt: new Date(Date.now() + processingRetryDelay(job.attempts)), leaseOwner: null, leaseExpiresAt: null, failureCode: retry ? 'TRANSIENT' : 'ACTION_REQUIRED', failureMessage: retry ? 'Processing will retry automatically.' : 'Analysis could not complete. Retry analysis or classify manually.' } });
        if (!retry && job.draftDocumentId) await tx.applicationDraftDocument.updateMany({ where: { id: job.draftDocumentId, cancelledAt: null, analysisStatus: { not: ApplicationDraftDocumentStatus.SUCCESS } }, data: { analysisStatus: 'FAILED', analysisError: 'Analysis unavailable. Retry analysis or classify manually.' } });
        if (!retry && job.projectDocumentId) await tx.projectDocument.updateMany({ where: { id: job.projectDocumentId, organisationId: job.organisationId }, data: { analysisStatus: 'FAILED' } });
        if (!retry && job.kind === 'PREPARE') await tx.applicationDraft.updateMany({ where: { id: job.draftId!, organisationId: job.organisationId, status: 'ANALYSING', documentSetRevision: job.documentSetRevision!, reviewRevision: job.reviewRevision! }, data: { status: 'FAILED' } });
      });
      console.info('document-processing', { id: job.id, organisationId: job.organisationId, stage: job.kind, attempt: job.attempts, retry });
    }
    if (job.draftId) {
      const draft = await getApplicationDraftForOrganisation(job.draftId, job.organisationId);
      if (draft.status === 'ANALYSING') {
        const completed = draft.documents.filter(document => !['PENDING', 'ANALYSING'].includes(document.analysisStatus)).length;
        const retrying = await prisma.documentProcessingJob.count({ where: { draftId: job.draftId, organisationId: job.organisationId, state: 'RETRYING' } });
        await prisma.applicationDraft.updateMany({ where: { id: job.draftId, organisationId: job.organisationId, status: 'ANALYSING', documentSetRevision: draft.documentSetRevision }, data: { analysisSummary: { phase: retrying ? 'retrying' : 'document-analysis', completed, total: draft.documents.length, message: retrying ? 'Processing paused for an automatic retry. Uploaded files are safe.' : `${completed} of ${draft.documents.length} documents analysed` } } });
      }
      await enqueuePreparedReview(job.draftId, job.organisationId);
    }
    processed++;
  }
  // Also recover review generation after a worker died between completion and enqueue.
  const pendingDrafts = await prisma.applicationDraft.findMany({ where: { status: 'ANALYSING', ...(organisationId ? { organisationId } : {}), ...(inline ? { id: inline.draftId } : {}) }, select: { id: true, organisationId: true }, take: 50 });
  for (const draft of pendingDrafts) await enqueuePreparedReview(draft.id, draft.organisationId);
  return { processed, skipped: false };
}

export async function runInlineDraftProcessing(draftId: string, organisationId: string, options: { maxJobs?: number; deadline?: number } = {}) {
  const before = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (before.status === 'ANALYSING') {
    // Recovery also covers termination between persisting evidence and queuing preparation.
    await enqueuePreparedReview(draftId, organisationId);
    await runProcessingJobs(organisationId, { draftId, maxJobs: options.maxJobs ?? 2, deadline: options.deadline });
  }
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (draft.status !== 'ANALYSING') return { mode: 'inline' as const, continueAfterMs: null };
  const jobs = await prisma.documentProcessingJob.findMany({ where: { draftId, organisationId, state: { in: ['WAITING', 'RETRYING', 'RUNNING'] } } });
  const next = jobs.length ? Math.min(...jobs.map(job => (job.state === 'RUNNING' ? job.leaseExpiresAt ?? job.nextAttemptAt : job.nextAttemptAt).getTime())) : null;
  const completed = draft.documents.filter(document => document.analysisStatus === 'SUCCESS' || document.analysisStatus === 'FALLBACK').length;
  const continueAfterMs = next === null ? null : Math.max(1500, next - Date.now());
  await prisma.applicationDraft.updateMany({ where: { id: draftId, organisationId, status: 'ANALYSING', documentSetRevision: draft.documentSetRevision }, data: {
    ...(next === null ? { status: 'FAILED' } : {}),
    analysisSummary: { phase: 'document-analysis', completed, total: draft.documents.length,
      message: next === null ? 'Preparation paused. Retry using the uploaded files.' : next > Date.now() ? 'Analysis is waiting to retry an interrupted request. Uploaded files and completed results are safe.' : `${completed} of ${draft.documents.length} documents analysed. Continuing preparation.` },
  } });
  return { mode: 'inline' as const, continueAfterMs };
}
