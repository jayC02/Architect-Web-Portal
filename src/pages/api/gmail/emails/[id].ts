export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { extractGmailUpdates } from '@/lib/integrations/gmail-tracking';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { gmailSuggestionDedupeKey } from '@/server/services/gmail-updates.service';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('unrelated') }),
  z.object({
    action: z.literal('link'),
    projectId: z.string().min(1),
    applicationType: z.enum(['PLANNING', 'BUILDING_WARRANT', 'GENERAL']).default('GENERAL'),
  }),
]);

const json = (value: unknown) => value as never;

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'gmail:email-review');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Email id is required.');
  const body = await parseBody(context.request, schema);
  const email = await prisma.trackedEmail.findFirst({ where: { id, organisationId: organisation.id } });
  if (!email) throw new HttpError(404, 'Tracked email not found.');

  if (body.action === 'unrelated') {
    await prisma.trackedEmail.updateMany({
      where: { organisationId: organisation.id, gmailThreadId: email.gmailThreadId },
      data: { matchStatus: 'UNRELATED', processingStatus: 'PROCESSED', projectId: null },
    });
    await prisma.gmailUpdateSuggestion.updateMany({
      where: { organisationId: organisation.id, trackedEmail: { gmailThreadId: email.gmailThreadId }, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date() },
    });
    return jsonResponse(200, { ok: true });
  }

  const project = await prisma.project.findFirst({
    where: { id: body.projectId, organisationId: organisation.id },
    include: {
      planningApplications: { orderBy: { updatedAt: 'desc' }, take: 1 },
      warrantApplications: { orderBy: { updatedAt: 'desc' }, take: 1 },
    },
  });
  if (!project) throw new HttpError(400, 'The selected project is not available in this organisation.');
  const planning = body.applicationType === 'PLANNING' ? project.planningApplications[0] ?? null : null;
  const warrant = body.applicationType === 'BUILDING_WARRANT' ? project.warrantApplications[0] ?? null : null;
  await prisma.trackedEmail.updateMany({
    where: { organisationId: organisation.id, gmailThreadId: email.gmailThreadId },
    data: {
      matchStatus: 'MATCHED',
      processingStatus: 'PROCESSED',
      projectId: project.id,
      planningApplicationId: planning?.id ?? null,
      buildingWarrantApplicationId: warrant?.id ?? null,
      matchConfidence: 1,
      matchReason: 'Linked manually by an organisation member.',
      processedAt: new Date(),
    },
  });

  const updates = extractGmailUpdates({
    sender: email.sender,
    subject: email.subject,
    text: email.textExcerpt ?? '',
    sentAt: email.sentAt,
  });
  for (const update of updates) {
    if (update.updateType === 'PLANNING_APPLICATION' && body.applicationType !== 'PLANNING') continue;
    if (update.updateType === 'BUILDING_WARRANT' && body.applicationType !== 'BUILDING_WARRANT') continue;
    const suggestedValue = update.deadline ?? update.value;
    const currentRecord = update.updateType === 'PLANNING_APPLICATION' ? planning
      : update.updateType === 'BUILDING_WARRANT' ? warrant
        : null;
    const existingValue = currentRecord
      ? (currentRecord as unknown as Record<string, unknown>)[update.fieldName] ?? null
      : null;
    const dedupeKey = gmailSuggestionDedupeKey({
      updateType: update.updateType,
      fieldName: update.fieldName,
      value: suggestedValue,
    });
    await prisma.gmailUpdateSuggestion.upsert({
      where: { trackedEmailId_dedupeKey: { trackedEmailId: email.id, dedupeKey } },
      update: {},
      create: {
        organisationId: organisation.id,
        trackedEmailId: email.id,
        projectId: project.id,
        planningApplicationId: planning?.id,
        buildingWarrantApplicationId: warrant?.id,
        updateType: update.updateType,
        fieldName: update.fieldName,
        dedupeKey,
        existingValue: json(existingValue instanceof Date ? existingValue.toISOString() : existingValue),
        suggestedValue: json(suggestedValue),
        confidence: update.confidence,
        reason: `${update.reason} Project linked manually.`,
      },
    });
  }
  if (updates.length) {
    await prisma.trackedEmail.update({ where: { id: email.id }, data: { processingStatus: 'NEEDS_REVIEW' } });
  }
  return jsonResponse(200, { ok: true, suggestionsCreated: updates.length });
}, context);
