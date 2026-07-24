export const prerender = false;

import { DocumentSortBatchStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  classificationAuditForSuggestion,
  classifyProjectDocumentBatch,
} from '@/server/services/pdf-classification.service';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'document-sort-batches:analyse');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Sort batch id is required.');

    const batch = await prisma.documentSortBatch.findFirst({
      where: { id, organisationId: organisation.id },
      include: {
        project: { select: { name: true, projectType: true, stage: true } },
        items: { include: { document: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!batch) throw new HttpError(404, 'Document sort batch not found.');
    if (batch.status === DocumentSortBatchStatus.ACCEPTED) {
      throw new HttpError(400, 'Accepted sort batches cannot be analysed again.');
    }

    await prisma.documentSortBatch.update({
      where: { id: batch.id },
      data: { status: DocumentSortBatchStatus.ANALYSING },
    });

    try {
      const inputs = await Promise.all(batch.items.map(async (item) => ({
        documentId: item.documentId ?? undefined,
        filename: item.originalFilename,
        mimeType: item.document?.mimeType,
        bytes: item.document?.storageKey
          ? await readStoredDocumentBytes(item.document.storageKey).catch(() => undefined)
          : undefined,
      })));
      const suggestions = await classifyProjectDocumentBatch(inputs, {
        projectName: batch.project.name,
        typeOfWork: batch.project.projectType ?? undefined,
        applicationType: batch.project.stage,
      });

      await prisma.$transaction(suggestions.map((suggestion, index) => {
        const item = batch.items[index];
        const audit = classificationAuditForSuggestion(suggestion);
        return prisma.documentSortBatchItem.update({
          where: { id: item.id },
          data: {
            suggestedDocumentType: suggestion.suggestedDocumentType,
            confidence: suggestion.confidence,
            reason: suggestion.reason,
            matchedRules: {
              ...audit,
              previousAnalysis: item.matchedRules,
            },
            revision: suggestion.revision,
            drawingNumber: suggestion.drawingNumber,
            drawingTitle: suggestion.drawingTitle,
            source: suggestion.source,
            isLikelyCurrent: suggestion.isLikelyCurrent,
            suitableForPlanning: suggestion.suitableForPlanning,
            suitableForBuildingWarrant: suggestion.suitableForBuildingWarrant,
          },
        });
      }));

      await prisma.documentSortBatch.update({
        where: { id: batch.id },
        data: { status: DocumentSortBatchStatus.NEEDS_REVIEW },
      });

      return jsonResponse(200, { ok: true });
    } catch (error) {
      await prisma.documentSortBatch.update({
        where: { id: batch.id },
        data: { status: DocumentSortBatchStatus.FAILED },
      });
      throw error;
    }
  }, context);
