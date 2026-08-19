export const prerender = false;

import type { APIRoute } from 'astro';
import { CalendarProvider } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getGoogleAccessToken, googleConnectionHasGmailScope } from '@/lib/integrations/google-calendar';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { ingestGmailProjectDocument } from '@/server/services/gmail-document-ingestion.service';

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
  const result = await ingestGmailProjectDocument({
    organisationId: organisation.id,
    projectId: attachment.trackedEmail.projectId,
    trackedEmailId: attachment.trackedEmailId,
    gmailAttachmentId: attachment.id,
    gmailMessageId: attachment.trackedEmail.gmailMessageId,
    filename: attachment.fileName,
    mimeType: attachment.mimeType,
    bytes,
    initiatedByUserId: user.id,
  });
  return jsonResponse(result.alreadyImported ? 200 : 201, { ok: true, ...result });
}, context);
