import { DocumentSortSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { HttpError } from '@/lib/utils/http';
import {
  analysisStatusForSuggestion, classificationAuditForSuggestion, classifyProjectDocumentBatch,
  configuredDocumentAnalysisIdentity, DOCUMENT_ANALYSIS_VERSION,
  DOCUMENT_ANALYSIS_PROMPT_VERSION, DOCUMENT_ANALYSIS_SCHEMA_VERSION,
} from './pdf-classification.service';

// Compatibility for documents already saved by the retired direct-upload routes.
// Uses the same awaited classifier as the original project sorting endpoint.
export async function analyseStoredProjectDocument(documentId: string, organisationId: string) {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, organisationId }, include: { project: { include: { client: true, site: true } } },
  });
  if (!document) throw new HttpError(404, 'Document not found.');
  try {
    const bytes = await readStoredDocumentBytes(document.storageKey, document.storageUrl);
    const { project } = document;
    const [suggestion] = await classifyProjectDocumentBatch([
      { documentId, filename: document.originalName, mimeType: document.mimeType, bytes },
    ], {
      projectName: project.name, typeOfWork: project.projectType ?? undefined, applicationType: project.stage,
      siteAddress: project.site ? [project.site.addressLine1, project.site.addressLine2, project.site.townCity, project.site.postcode].filter(Boolean).join(', ') : project.siteAddress ?? undefined,
      localAuthority: project.site?.localAuthority ?? project.localAuthority ?? undefined,
      clientName: project.client?.name, projectNotes: project.notes ?? undefined,
    });
    const identity = configuredDocumentAnalysisIdentity();
    return await prisma.projectDocument.update({ where: { id: document.id }, data: {
      analysisStatus: analysisStatusForSuggestion(suggestion),
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisProvider: suggestion.classificationDetails?.provider ?? identity.provider,
      analysisModel: suggestion.classificationDetails?.model ?? identity.model,
      analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION, analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      analysisResult: classificationAuditForSuggestion(suggestion) as Prisma.InputJsonValue, analysedAt: new Date(),
      ...(document.sortSource === DocumentSortSource.MANUAL ? {} : {
        type: suggestion.suggestedDocumentType, revision: suggestion.revision, drawingNumber: suggestion.drawingNumber,
        drawingTitle: suggestion.drawingTitle, sortSource: suggestion.source,
        sortConfidence: suggestion.confidence, sortReason: suggestion.reason,
      }),
    } });
  } catch {
    await prisma.projectDocument.updateMany({ where: { id: document.id, organisationId }, data: { analysisStatus: 'FAILED' } });
    throw new HttpError(503, 'Analysis did not finish. The uploaded PDF is kept; retry analysis without uploading again.');
  }
}
