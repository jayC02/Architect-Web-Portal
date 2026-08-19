import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  DocumentSortBatchStatus,
  DocumentStatus,
  LifecycleActorType,
  ProjectActivityEventType,
  ProjectActivityVisibility,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { saveUploadedDocument } from '@/lib/server/uploads';
import { HttpError } from '@/lib/utils/http';
import {
  analysisStatusForSuggestion,
  classificationAuditForSuggestion,
  classifyProjectDocumentBatch,
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_ANALYSIS_VERSION,
} from '@/server/services/pdf-classification.service';

type Dependencies = {
  database: PrismaClient;
  save: typeof saveUploadedDocument;
  classify: typeof classifyProjectDocumentBatch;
};

const defaultDependencies: Dependencies = {
  database: prisma,
  save: saveUploadedDocument,
  classify: classifyProjectDocumentBatch,
};

export const ingestGmailProjectDocument = async (input: {
  organisationId: string;
  projectId: string;
  trackedEmailId: string;
  gmailAttachmentId: string;
  gmailMessageId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  initiatedByUserId: string;
  decisionNotice?: boolean;
}, dependencies: Partial<Dependencies> = {}) => {
  const deps = { ...defaultDependencies, ...dependencies };
  const attachment = await deps.database.gmailAttachment.findFirst({
    where: {
      id: input.gmailAttachmentId,
      organisationId: input.organisationId,
      trackedEmailId: input.trackedEmailId,
      trackedEmail: { projectId: input.projectId, gmailMessageId: input.gmailMessageId },
    },
    select: { id: true, importedDocumentId: true },
  });
  if (!attachment) throw new HttpError(404, 'Email attachment not found for this project.');
  if (attachment.importedDocumentId) {
    return { documentId: attachment.importedDocumentId, alreadyImported: true, duplicateByHash: false };
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const duplicate = await deps.database.projectDocument.findFirst({
    where: { organisationId: input.organisationId, projectId: input.projectId, fileHash: sha256 },
    select: { id: true },
  });
  if (duplicate) {
    await deps.database.gmailAttachment.update({ where: { id: attachment.id }, data: { sha256 } });
    return { documentId: duplicate.id, alreadyImported: true, duplicateByHash: true };
  }

  const project = await deps.database.project.findFirst({
    where: { id: input.projectId, organisationId: input.organisationId },
    include: { client: true, site: true },
  });
  if (!project) throw new HttpError(404, 'Project not found.');

  const safeName = path.basename(input.filename).replace(/[\\/]/g, '_').slice(0, 255) || 'email-attachment.pdf';
  const file = new File([new Uint8Array(input.bytes)], safeName, { type: input.mimeType });
  const saved = await deps.save(file, {
    folder: `organisations/${input.organisationId}/projects/${input.projectId}`,
    label: 'email attachment',
  });
  const [suggestion] = await deps.classify([{
    filename: safeName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  }], {
    projectName: project.name,
    typeOfWork: project.projectType ?? undefined,
    applicationType: project.stage,
    siteAddress: project.site
      ? [project.site.addressLine1, project.site.addressLine2, project.site.townCity, project.site.postcode].filter(Boolean).join(', ')
      : project.siteAddress ?? undefined,
    localAuthority: project.site?.localAuthority ?? project.localAuthority ?? undefined,
    clientName: project.client?.name,
    projectNotes: project.notes ?? undefined,
  });
  if (!suggestion) throw new Error('The existing document classifier returned no suggestion.');
  const analysisAudit = classificationAuditForSuggestion(suggestion);

  const result = await deps.database.$transaction(async (tx) => {
    const batch = await tx.documentSortBatch.create({
      data: {
        organisationId: input.organisationId,
        projectId: input.projectId,
        createdById: input.initiatedByUserId,
        fileCount: 1,
        status: DocumentSortBatchStatus.NEEDS_REVIEW,
        items: {
          create: {
            originalFilename: safeName,
            suggestedDocumentType: suggestion.suggestedDocumentType,
            confidence: suggestion.confidence,
            reason: suggestion.reason,
            matchedRules: analysisAudit,
            revision: suggestion.revision,
            drawingNumber: suggestion.drawingNumber,
            drawingTitle: suggestion.drawingTitle,
            source: suggestion.source,
            isLikelyCurrent: suggestion.isLikelyCurrent,
            suitableForPlanning: suggestion.suitableForPlanning,
            suitableForBuildingWarrant: suggestion.suitableForBuildingWarrant,
            document: {
              create: {
                organisationId: input.organisationId,
                projectId: input.projectId,
                uploadedById: input.initiatedByUserId,
                originalName: safeName,
                ...saved,
                type: suggestion.suggestedDocumentType,
                revision: suggestion.revision,
                status: DocumentStatus.IN_REVIEW,
                drawingNumber: suggestion.drawingNumber,
                drawingTitle: suggestion.drawingTitle,
                sortSource: suggestion.source,
                sortConfidence: suggestion.confidence,
                sortReason: suggestion.reason,
                fileHash: sha256,
                analysisVersion: DOCUMENT_ANALYSIS_VERSION,
                analysisProvider: suggestion.classificationDetails?.provider ?? 'deterministic',
                analysisModel: suggestion.classificationDetails?.model,
                analysisPromptVersion: suggestion.classificationDetails?.promptVersion ?? DOCUMENT_ANALYSIS_PROMPT_VERSION,
                analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
                analysisStatus: analysisStatusForSuggestion(suggestion),
                analysisResult: analysisAudit,
                analysedAt: new Date(),
                notes: `Imported from Gmail. Source message ${input.gmailMessageId}.`,
              },
            },
          },
        },
      },
      include: { items: { select: { documentId: true } } },
    });
    const documentId = batch.items[0]?.documentId;
    if (!documentId) throw new Error('The Gmail document was not created.');
    await tx.gmailAttachment.update({
      where: { id: attachment.id },
      data: { sha256, importedDocumentId: documentId },
    });
    if (input.decisionNotice) {
      await tx.projectActivity.upsert({
        where: {
          organisationId_idempotencyKey: {
            organisationId: input.organisationId,
            idempotencyKey: `gmail:${input.gmailMessageId}:attachment:${attachment.id}:imported`,
          },
        },
        update: {},
        create: {
          organisationId: input.organisationId,
          projectId: input.projectId,
          eventType: ProjectActivityEventType.DECISION_NOTICE_IMPORTED,
          summary: 'Decision notice imported from Gmail',
          actorType: LifecycleActorType.SYSTEM,
          sourceType: 'TRACKED_EMAIL',
          sourceId: input.trackedEmailId,
          visibility: ProjectActivityVisibility.STANDARD,
          occurredAt: new Date(),
          idempotencyKey: `gmail:${input.gmailMessageId}:attachment:${attachment.id}:imported`,
        },
      });
    }
    return { documentId, batchId: batch.id };
  });

  return { ...result, alreadyImported: false, duplicateByHash: false };
};

export const isLikelyDecisionNoticeAttachment = (input: {
  fileName: string;
  mimeType: string;
  subject: string;
}) => input.mimeType.toLowerCase() === 'application/pdf'
  && /\b(decision|notice|approval|approved|refusal|refused|grant)\b/i.test(`${input.fileName} ${input.subject}`);
