export const prerender = false;

import { createHash } from 'node:crypto';
import { DocumentSortBatchStatus, DocumentSortSource, DocumentStatus, Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { saveUploadedDocument } from '@/lib/server/uploads';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  classificationAuditForSuggestion,
  analysisStatusForSuggestion,
  classificationDetailsFromAudit,
  classifyProjectDocumentBatch,
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_ANALYSIS_VERSION,
} from '@/server/services/pdf-classification.service';
import type { DocumentSortSuggestion } from '@/server/services/document-sorter.service';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';

const MAX_BATCH_FILES = 50;

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'document-sort-batches:create');
    const { user, organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organisationId: organisation.id },
      include: { client: true, site: true },
    });
    if (!project) throw new HttpError(404, 'Project not found.');

    const form = await context.request.formData();
    const files = form.getAll('files').filter((file): file is File => file instanceof File && file.size > 0);
    const submittedReturnTo = form.get('returnTo');
    const returnTo = submittedReturnTo === 'document-folder' || submittedReturnTo === 'project-detail' ? submittedReturnTo : 'project-files';
    if (!files.length) throw new HttpError(400, 'Choose at least one document to auto-sort.');
    if (files.length > MAX_BATCH_FILES) throw new HttpError(400, `Auto-sort batches are limited to ${MAX_BATCH_FILES} files.`);

    const uploaded: Array<{
      file: File;
      bytes: Buffer;
      saved: Awaited<ReturnType<typeof saveUploadedDocument>>;
      fileHash: string;
    }> = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const saved = await saveUploadedDocument(file, {
        folder: `organisations/${organisation.id}/projects/${projectId}`,
        label: 'document',
      });
      uploaded.push({
        file,
        bytes,
        saved,
        fileHash: createHash('sha256').update(bytes).digest('hex'),
      });
    }

    const cachedDocuments = await prisma.projectDocument.findMany({
      where: {
        organisationId: organisation.id,
        projectId,
        fileHash: { in: uploaded.map((item) => item.fileHash) },
        analysisVersion: DOCUMENT_ANALYSIS_VERSION,
        analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
        analysisStatus: 'SUCCESS',
        analysisResult: { not: Prisma.JsonNull },
      },
      orderBy: { analysedAt: 'desc' },
    });
    const cacheByHash = new Map(cachedDocuments.map((document) => [document.fileHash, document]));
    const pendingIndexes = uploaded
      .map((item, index) => cacheByHash.has(item.fileHash) ? -1 : index)
      .filter((index) => index >= 0);
    const freshSuggestions = await classifyProjectDocumentBatch(pendingIndexes.map((index) => {
      const { file, bytes } = uploaded[index];
      return { filename: file.name, mimeType: file.type, bytes };
    }), {
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
    const freshByIndex = new Map(pendingIndexes.map((index, offset) => [index, freshSuggestions[offset]]));
    const suggestions: DocumentSortSuggestion[] = uploaded.map((item, index) => {
      const fresh = freshByIndex.get(index);
      if (fresh) return fresh;
      const cached = cacheByHash.get(item.fileHash)!;
      const details = classificationDetailsFromAudit(cached.analysisResult);
      return {
        originalFilename: item.file.name,
        suggestedDocumentType: cached.type,
        confidence: cached.sortConfidence ?? 0.5,
        reason: cached.sortReason ?? 'Reused a validated analysis of this unchanged file.',
        matchedRules: ['cached document intelligence'],
        revision: cached.revision,
        drawingNumber: cached.drawingNumber,
        drawingTitle: cached.drawingTitle,
        source: cached.sortSource ?? DocumentSortSource.RULES,
        isLikelyCurrent: true,
        suitableForPlanning: true,
        suitableForBuildingWarrant: true,
        classificationDetails: details
          ? { ...details, warnings: details.warnings ?? [], promptVersion: details.promptVersion ?? DOCUMENT_ANALYSIS_PROMPT_VERSION }
          : undefined,
      };
    });

    const batch = await prisma.documentSortBatch.create({
      data: {
        organisationId: organisation.id,
        projectId,
        createdById: user.id,
        fileCount: uploaded.length,
        status: DocumentSortBatchStatus.NEEDS_REVIEW,
        items: {
          create: uploaded.map(({ file, saved, fileHash }, index) => {
            const suggestion = suggestions[index];
            const analysisAudit = classificationAuditForSuggestion(suggestion);
            const cached = cacheByHash.get(fileHash);
            return {
              originalFilename: file.name || saved.fileName,
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
                  organisationId: organisation.id,
                  projectId,
                  uploadedById: user.id,
                  originalName: file.name || saved.fileName,
                  ...saved,
                  type: suggestion.suggestedDocumentType,
                  revision: suggestion.revision,
                  status: DocumentStatus.IN_REVIEW,
                  drawingNumber: suggestion.drawingNumber,
                  drawingTitle: suggestion.drawingTitle,
                  sortSource: suggestion.source,
                  sortConfidence: suggestion.confidence,
                  sortReason: suggestion.reason,
                  fileHash,
                  analysisVersion: DOCUMENT_ANALYSIS_VERSION,
                  analysisProvider: suggestion.classificationDetails?.provider ?? cached?.analysisProvider ?? 'deterministic',
                  analysisModel: suggestion.classificationDetails?.model ?? cached?.analysisModel,
                  analysisPromptVersion: suggestion.classificationDetails?.promptVersion ?? DOCUMENT_ANALYSIS_PROMPT_VERSION,
                  analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
                  analysisStatus: analysisStatusForSuggestion(suggestion),
                  analysisResult: analysisAudit,
                  analysedAt: new Date(),
                  notes: suggestion.classificationDetails?.manualReviewRequired
                    ? 'Needs attention after automatic sorting.'
                    : null,
                },
              },
            };
          }),
        },
      },
      include: { items: true },
    });

    return jsonResponse(201, {
      batch,
      redirectTo: `/projects/${projectId}/files/sort/${batch.id}${returnTo !== 'project-files' ? '?returnTo=' + returnTo : ''}`,
    });
  }, context);
