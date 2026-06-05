export const prerender = false;

import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentSortBatchStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { classifyDocumentBatch } from '@/server/services/document-sorter.service';
import { requireOrganisation } from '@/server/permissions/authz';

const readLocalDocumentBytes = async (storageKey: string | null) => {
  if (!storageKey || (process.env.UPLOAD_STORAGE_PROVIDER ?? 'local') !== 'local') return undefined;
  const configuredLocalDir = process.env.UPLOAD_STORAGE_DIR ?? 'public/uploads';
  const storageRoot = path.isAbsolute(configuredLocalDir) ? configuredLocalDir : path.resolve(process.cwd(), configuredLocalDir);
  const resolvedRoot = path.resolve(storageRoot);
  const resolvedFile = path.resolve(resolvedRoot, storageKey);
  if (!resolvedFile.toLowerCase().startsWith(resolvedRoot.toLowerCase() + path.sep)) return undefined;
  return fs.readFile(resolvedFile).catch(() => undefined);
};

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'document-sort-batches:analyse');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Sort batch id is required.');

    const batch = await prisma.documentSortBatch.findFirst({
      where: { id, organisationId: organisation.id },
      include: { items: { include: { document: true }, orderBy: { createdAt: 'asc' } } },
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
        bytes: await readLocalDocumentBytes(item.document?.storageKey ?? null),
      })));
      const suggestions = await classifyDocumentBatch(inputs);

      await prisma.$transaction(suggestions.map((suggestion, index) => {
        const item = batch.items[index];
        return prisma.documentSortBatchItem.update({
          where: { id: item.id },
          data: {
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
  });
