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
  if (!processingEnabled()) throw new HttpError(503, 'Background processing is awaiting worker configuration. Your files are safe.');
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (terminalDraft.includes(draft.status) || draft.expiresAt <= new Date()) throw new HttpError(409, 'This draft cannot be analysed.');
  if (!draft.documents.length || draft.documents.some(document => document.uploadStatus !== 'READY')) throw new HttpError(409, 'Finish uploading each document before analysis.');
  await prisma.$transaction(async tx => {
    const changed = await tx.applicationDraft.updateMany({ where: { id: draftId, organisationId, documentSetRevision: draft.documentSetRevision, status: { notIn: [ApplicationDraftStatus.COMMITTED, ApplicationDraftStatus.COMMITTING, ApplicationDraftStatus.CANCELLED, ApplicationDraftStatus.EXPIRED] } }, data: { status: 'ANALYSING', analysisSummary: { phase: 'processing', completed: 0, total: draft.documents.length, message: 'Documents queued. Processing continues after you leave this page.' } } });
    if (!changed.count) throw new HttpError(409, 'The document set changed. Reload and retry.');
    for (const document of draft.documents) {
      // Explicit retries never repeat successful analysis of unchanged content.
      if (document.analysisStatus === 'SUCCESS' && document.analysisVersion === DOCUMENT_ANALYSIS_VERSION && document.analysisPromptVersion === DOCUMENT_ANALYSIS_PROMPT_VERSION && document.analysisSchemaVersion === DOCUMENT_ANALYSIS_SCHEMA_VERSION) continue;
      const idempotencyKey = createHash('sha256').update(`${organisationId}:${document.id}:${document.sha256}:${version}`).digest('hex');
      const existing = await tx.documentProcessingJob.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (['SUCCEEDED', 'CANCELLED'].includes(existing.state) || (options.force && existing.state === 'FAILED')) await tx.documentProcessingJob.update({ where: { id: existing.id }, data: { state: 'WAITING', attempts: 0, nextAttemptAt: new Date(), completedAt: null, failureCode: null, failureMessage: null, documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision } });
        continue;
      }
      await tx.documentProcessingJob.create({ data: { organisationId, draftId, draftDocumentId: document.id, idempotencyKey, processingVersion: version, documentSetRevision: draft.documentSetRevision, reviewRevision: draft.reviewRevision } });
      await tx.applicationDraftDocument.updateMany({ where: { id: document.id, cancelledAt: null }, data: { analysisStatus: 'PENDING', analysisError: null } });
    }
  });
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

export async function claimProcessingJob(owner: string, organisationId?: string) {
  // Organisation locking prevents two workers from both observing an empty slot.
  const candidates = await prisma.documentProcessingJob.findMany({ where: { ...(organisationId ? { organisationId } : {}), OR: [{ state: { in: ['WAITING', 'RETRYING'] }, nextAttemptAt: { lte: new Date() } }, { state: 'RUNNING', leaseExpiresAt: { lte: new Date() } }] }, select: { organisationId: true }, distinct: ['organisationId'], take: 20, orderBy: { nextAttemptAt: 'asc' } });
  for (const candidate of candidates) {
    const claimed = await retryDatabaseTransaction(() => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ${databaseTable('Organisation')} WHERE id = ${candidate.organisationId} FOR UPDATE`;
      const now = new Date();
      const active = await tx.documentProcessingJob.count({ where: { organisationId: candidate.organisationId, state: 'RUNNING', leaseExpiresAt: { gt: now } } });
      if (active >= 2) return null;
      const [job] = await tx.$queryRaw<DocumentProcessingJob[]>`SELECT * FROM ${databaseTable('DocumentProcessingJob')} WHERE "organisationId" = ${candidate.organisationId}
        AND (("state" IN ('WAITING', 'RETRYING') AND "nextAttemptAt" <= ${now}) OR ("state" = 'RUNNING' AND "leaseExpiresAt" <= ${now}))
        ORDER BY "nextAttemptAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!job) return null;
      if (job.attempts >= PROCESSING_ATTEMPTS) {
        await tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: 'FAILED', failureCode: 'ATTEMPTS_EXHAUSTED', failureMessage: 'Processing stopped after five attempts. Retry analysis or classify manually.', leaseOwner: null, leaseExpiresAt: null } });
        if (job.draftDocumentId) await tx.applicationDraftDocument.updateMany({ where: { id: job.draftDocumentId, cancelledAt: null, analysisStatus: { not: 'SUCCESS' } }, data: { analysisStatus: 'FAILED', analysisError: 'Processing interrupted repeatedly. Retry analysis or classify manually.' } });
        if (job.projectDocumentId) await tx.projectDocument.updateMany({ where: { id: job.projectDocumentId, organisationId: job.organisationId }, data: { analysisStatus: 'FAILED' } });
        return null;
      }
      return tx.documentProcessingJob.update({ where: { id: job.id }, data: { state: 'RUNNING', attempts: { increment: 1 }, leaseGeneration: { increment: 1 }, leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + PROCESSING_LEASE_MS) } });
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

async function processClaim(job: DocumentProcessingJob) {
  if (job.kind === 'PREPARE') {
    await prepareApplicationDraft(job.draftId!, job.organisationId, { job });
    return;
  }
  const draftDocument = job.draftDocumentId ? await prisma.applicationDraftDocument.findFirst({ where: { id: job.draftDocumentId, cancelledAt: null, draft: { organisationId: job.organisationId, status: { notIn: [ApplicationDraftStatus.COMMITTED, ApplicationDraftStatus.COMMITTING, ApplicationDraftStatus.CANCELLED, ApplicationDraftStatus.EXPIRED] } } } }) : null;
  const projectDocument = job.projectDocumentId ? await prisma.projectDocument.findFirst({ where: { id: job.projectDocumentId, organisationId: job.organisationId } }) : null;
  const document = draftDocument ?? projectDocument;
  if (!document) { await fencedProcessingWrite(job, async () => {}); return; }
  const bytes = await readStoredDocumentBytes(document.storageKey, 'storageUrl' in document ? document.storageUrl : undefined);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expectedHash = draftDocument?.sha256 ?? projectDocument?.fileHash;
  if (expectedHash && expectedHash !== sha256) throw new HttpError(400, 'Document integrity failed.');
  const [suggestion] = await classifyProjectDocumentBatch([{ documentId: document.id, filename: draftDocument?.originalFilename ?? projectDocument!.originalName, mimeType: document.mimeType, bytes }]);
  const status = suggestion.classificationDetails?.aiStatus;
  if (status === 'provider_unavailable' && suggestion.classificationDetails?.provider && suggestion.classificationDetails?.providerHttpStatus !== 401 && suggestion.classificationDetails?.providerHttpStatus !== 403) throw new HttpError(503, 'Document provider temporarily unavailable.');
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
  const owner = randomUUID();
  const deadline = Date.now() + PROCESSING_WORKER_BUDGET_MS;
  let processed = 0;
  while (Date.now() + PROCESSING_LEASE_MS < deadline && processed < 4) {
    const job = await claimProcessingJob(owner, organisationId);
    if (!job) break;
    try { await processClaim(job); }
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
  const pendingDrafts = await prisma.applicationDraft.findMany({ where: { status: 'ANALYSING', ...(organisationId ? { organisationId } : {}) }, select: { id: true, organisationId: true }, take: 50 });
  for (const draft of pendingDrafts) await enqueuePreparedReview(draft.id, draft.organisationId);
  return { processed, skipped: false };
}
