export const prerender = false;

import { DocumentSortBatchStatus, DocumentStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { saveUploadedDocument } from '@/lib/server/uploads';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { classifyDocumentBatch } from '@/server/services/document-sorter.service';
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

    const form = await context.request.formData();
    const files = form.getAll('files').filter((file): file is File => file instanceof File && file.size > 0);
    const returnTo = form.get('returnTo') === 'document-folder' ? 'document-folder' : 'project-files';
    if (!files.length) throw new HttpError(400, 'Choose at least one document to auto-sort.');
    if (files.length > MAX_BATCH_FILES) throw new HttpError(400, `Auto-sort batches are limited to ${MAX_BATCH_FILES} files.`);

    const uploaded = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const saved = await saveUploadedDocument(file, {
        folder: `organisations/${organisation.id}/projects/${projectId}`,
        label: 'document',
      });
      uploaded.push({ file, bytes, saved });
    }

    const suggestions = await classifyDocumentBatch(uploaded.map(({ file, bytes }) => ({
      filename: file.name,
      mimeType: file.type,
      bytes,
    })));

    const batch = await prisma.documentSortBatch.create({
      data: {
        organisationId: organisation.id,
        projectId,
        createdById: user.id,
        fileCount: uploaded.length,
        status: DocumentSortBatchStatus.NEEDS_REVIEW,
        items: {
          create: uploaded.map(({ file, saved }, index) => {
            const suggestion = suggestions[index];
            return {
              originalFilename: file.name || saved.fileName,
              suggestedDocumentType: suggestion.suggestedDocumentType,
              confidence: suggestion.confidence,
              reason: suggestion.reason,
              matchedRules: suggestion.matchedRules,
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
                  notes: suggestion.confidence < 0.55 ? 'Needs review after automatic sorting.' : null,
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
      redirectTo: `/projects/${projectId}/files/sort/${batch.id}${returnTo === 'document-folder' ? '?returnTo=document-folder' : ''}`,
    });
  }, context);