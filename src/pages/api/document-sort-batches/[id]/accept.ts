export const prerender = false;

import { DocumentSortBatchStatus, DocumentSortSource, DocumentStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import type { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { documentSortBatchAcceptSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

type AcceptBody = z.infer<typeof documentSortBatchAcceptSchema>;
type AcceptItem = AcceptBody['items'][number];

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'document-sort-batches:accept');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Sort batch id is required.');
    const body = await parseBody(context.request, documentSortBatchAcceptSchema);

    const batch = await prisma.documentSortBatch.findFirst({
      where: { id, organisationId: organisation.id },
      include: { items: true },
    });
    if (!batch) throw new HttpError(404, 'Document sort batch not found.');
    if (batch.status === DocumentSortBatchStatus.ACCEPTED) {
      throw new HttpError(400, 'This sort batch has already been accepted.');
    }

    const itemsById = new Map(batch.items.map((item) => [item.id, item]));
    const submittedItems = body.items as AcceptItem[];
    const submittedIds = new Set(submittedItems.map((item: AcceptItem) => item.itemId));
    if (submittedIds.size !== body.items.length) throw new HttpError(400, 'Duplicate sort items are not allowed.');

    const updates = [];
    const acceptedItemIds = new Set(batch.items.filter((item) => item.finalDocumentType).map((item) => item.id));
    for (const submitted of submittedItems) {
      const item = itemsById.get(submitted.itemId);
      if (!item) throw new HttpError(400, 'One or more sort items do not belong to this batch.');
      if (!item.documentId) throw new HttpError(400, 'One or more sort items are missing their uploaded document.');
      const source = submitted.documentType === item.suggestedDocumentType ? item.source : DocumentSortSource.MANUAL;

      updates.push(prisma.projectDocument.updateMany({
        where: { id: item.documentId, organisationId: organisation.id, projectId: batch.projectId },
        data: {
          type: submitted.documentType,
          revision: submitted.revision,
          status: submitted.status === DocumentStatus.IN_REVIEW ? DocumentStatus.APPROVED : submitted.status,
          notes: submitted.notes,
          drawingNumber: item.drawingNumber,
          drawingTitle: item.drawingTitle,
          sortSource: source,
          sortConfidence: item.confidence,
          sortReason: item.reason,
        },
      }));

      updates.push(prisma.documentSortBatchItem.update({
        where: { id: item.id },
        data: {
          finalDocumentType: submitted.documentType,
          revision: submitted.revision,
          source,
        },
      }));
      acceptedItemIds.add(item.id);
    }

    const allItemsAccepted = batch.items.every((item) => acceptedItemIds.has(item.id));
    updates.push(prisma.documentSortBatch.update({
      where: { id: batch.id },
      data: { status: allItemsAccepted ? DocumentSortBatchStatus.ACCEPTED : DocumentSortBatchStatus.NEEDS_REVIEW },
    }));

    await prisma.$transaction(updates);
    return jsonResponse(200, {
      ok: true,
      complete: allItemsAccepted,
      redirectTo: body.returnTo === 'project-detail' ? `/projects/${batch.projectId}#documents` : body.returnTo === 'document-folder' ? `/documents/projects/${batch.projectId}` : `/projects/${batch.projectId}/files`,
    });
  }, context);
