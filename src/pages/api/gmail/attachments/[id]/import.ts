export const prerender = false;

import crypto from 'node:crypto';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { CalendarProvider, DocumentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getGoogleAccessToken, googleConnectionHasGmailScope } from '@/lib/integrations/google-calendar';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { saveUploadedDocument } from '@/lib/server/uploads';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { classifyDocument } from '@/server/services/document-sorter.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.upload, 'gmail:attachment-import');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Attachment id is required.');
  const attachment = await prisma.gmailAttachment.findFirst({
    where: { id, organisationId: organisation.id },
    include: { trackedEmail: { select: { gmailMessageId: true, projectId: true } } },
  });
  if (!attachment) throw new HttpError(404, 'Email attachment not found.');
  if (!attachment.trackedEmail.projectId) throw new HttpError(409, 'Link the email to a project before importing attachments.');
  if (attachment.importedDocumentId) return jsonResponse(200, { ok: true, documentId: attachment.importedDocumentId, alreadyImported: true });

  const connection = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId: organisation.id, provider: CalendarProvider.GOOGLE } },
  });
  if (!connection || !connection.gmailEnabled || !googleConnectionHasGmailScope(connection)) {
    throw new HttpError(409, 'Reconnect Gmail before importing this attachment.');
  }
  const accessToken = await getGoogleAccessToken(connection);
  const response = await fetch(
    `${GMAIL_API}/users/me/messages/${encodeURIComponent(attachment.trackedEmail.gmailMessageId)}/attachments/${encodeURIComponent(attachment.gmailAttachmentId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, 'Gmail attachment could not be downloaded.');
  const payload = await response.json() as { data?: string };
  if (!payload.data) throw new HttpError(502, 'Gmail did not return attachment data.');
  const bytes = Buffer.from(payload.data, 'base64url');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate = await prisma.gmailAttachment.findFirst({
    where: {
      organisationId: organisation.id,
      sha256,
      importedDocumentId: { not: null },
      id: { not: attachment.id },
    },
    select: { importedDocumentId: true },
  });
  if (duplicate?.importedDocumentId) throw new HttpError(409, 'This attachment has already been imported.');

  const safeName = path.basename(attachment.fileName).replace(/[\\/]/g, '_').slice(0, 255) || 'email-attachment';
  const file = new File([bytes], safeName, { type: attachment.mimeType });
  const saved = await saveUploadedDocument(file, {
    folder: `organisations/${organisation.id}/projects/${attachment.trackedEmail.projectId}`,
    label: 'email attachment',
  });
  const suggestion = await classifyDocument({
    filename: safeName,
    mimeType: attachment.mimeType,
    bytes,
  });
  const document = await prisma.projectDocument.create({
    data: {
      organisationId: organisation.id,
      projectId: attachment.trackedEmail.projectId,
      uploadedById: user.id,
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
    },
  });
  await prisma.gmailAttachment.update({
    where: { id: attachment.id },
    data: { sha256, importedDocumentId: document.id },
  });
  return jsonResponse(201, { ok: true, documentId: document.id, alreadyImported: false });
}, context);
