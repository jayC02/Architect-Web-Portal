import type { Prisma } from '@prisma/client';
import {
  applicationDraftAnalysisSummary,
  parsedApplicationDraftReview,
  parsedPreparedApplicationDraft,
  type DraftReadinessIssue,
} from '@/server/services/application-draft.service';

type DraftWithDocuments = Prisma.ApplicationDraftGetPayload<{
  include: { documents: true };
}>;

const readinessIssues = (value: unknown): DraftReadinessIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const issue = entry as Record<string, unknown>;
    if (
      typeof issue.key !== 'string'
      || typeof issue.section !== 'string'
      || typeof issue.label !== 'string'
      || typeof issue.message !== 'string'
    ) return [];
    return [{
      key: issue.key,
      section: issue.section as DraftReadinessIssue['section'],
      label: issue.label,
      message: issue.message,
      ...(issue.legal === true ? { legal: true } : {}),
    }];
  });
};

export const applicationDraftResponse = (draft: DraftWithDocuments) => ({
  id: draft.id,
  status: draft.status,
  notes: draft.notes,
  suggestedApplicationType: draft.suggestedApplicationType,
  selectedApplicationType: draft.selectedApplicationType,
  prepared: parsedPreparedApplicationDraft(draft.preparedData),
  review: parsedApplicationDraftReview(draft.confirmedData),
  issues: readinessIssues(draft.unresolvedQuestions),
  analysis: applicationDraftAnalysisSummary(draft.analysisSummary),
  expiresAt: draft.expiresAt.toISOString(),
  committedAt: draft.committedAt?.toISOString() ?? null,
  createdAt: draft.createdAt.toISOString(),
  updatedAt: draft.updatedAt.toISOString(),
  result: draft.resultingProjectId ? {
    projectId: draft.resultingProjectId,
    planningId: draft.resultingPlanningId,
    warrantId: draft.resultingWarrantId,
    automationJobId: draft.resultingAutomationJobId,
  } : null,
  documents: draft.documents.map((document) => ({
    id: document.id,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    analysisStatus: document.analysisStatus,
    documentType: document.documentType,
    documentStatus: document.documentStatus,
    revision: document.revision,
    drawingNumber: document.drawingNumber,
    drawingTitle: document.drawingTitle,
    classificationSource: document.classificationSource,
    classificationReason: document.classificationReason,
    needsManualReview:
      document.analysisStatus === 'FALLBACK'
      || document.analysisStatus === 'FAILED'
      || document.documentStatus === 'IN_REVIEW',
    previewUrl: `/api/application-drafts/${draft.id}/documents/${document.id}`,
  })),
});

export type ApplicationDraftResponse = ReturnType<typeof applicationDraftResponse>;
