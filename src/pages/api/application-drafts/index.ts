export const prerender = false;

import { ApplicationDraftStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { applicationDraftCreateSchema } from '@/lib/validation/application-draft';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import {
  addApplicationDraftDocuments,
  applicationDraftExpiry,
  cancelApplicationDraft,
  cleanupExpiredApplicationDrafts,
} from '@/server/services/application-draft-files.service';
import { applicationDraftResponse } from '@/server/services/application-draft-view.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    await cleanupExpiredApplicationDrafts(organisation.id);
    const drafts = await prisma.applicationDraft.findMany({
      where: {
        organisationId: organisation.id,
        status: {
          notIn: [
            ApplicationDraftStatus.COMMITTED,
            ApplicationDraftStatus.CANCELLED,
            ApplicationDraftStatus.EXPIRED,
          ],
        },
      },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    return jsonResponse(200, { drafts: drafts.map(applicationDraftResponse) });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:create');
    const { organisation, user } = await requireOrganisation(context);
    const form = await context.request.formData();
    const files = form.getAll('files').filter(
      (entry): entry is File => entry instanceof File && entry.size > 0,
    );
    if (!files.length) throw new HttpError(400, 'Choose at least one project document.');
    const input = applicationDraftCreateSchema.parse({
      notes: form.get('notes'),
      applicationType: form.get('applicationType') || undefined,
    });
    const draft = await prisma.applicationDraft.create({
      data: {
        organisationId: organisation.id,
        createdById: user.id,
        status: ApplicationDraftStatus.UPLOADING,
        notes: input.notes,
        selectedApplicationType: input.applicationType,
        expiresAt: applicationDraftExpiry(),
        analysisSummary: {
          phase: 'upload',
          completed: 0,
          total: files.length,
          message: 'Uploading project documents',
        },
      },
    });
    try {
      await addApplicationDraftDocuments(draft.id, organisation.id, files);
    } catch (error) {
      await cancelApplicationDraft(draft.id, organisation.id).catch(() => undefined);
      throw error;
    }
    const created = await prisma.applicationDraft.findFirst({
      where: { id: draft.id, organisationId: organisation.id },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!created) throw new HttpError(500, 'Application draft could not be loaded.');
    return jsonResponse(201, {
      draft: applicationDraftResponse(created),
      redirectTo: `/applications/${created.id}`,
    });
  }, context);
