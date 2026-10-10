export const prerender = false;
import type { APIRoute } from 'astro';
import { requireOrganisation } from '@/server/permissions/authz';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertAuthenticatedUploadLimit } from '@/server/services/upload-limits.service';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { finaliseProjectUpload } from '@/server/services/project-upload.service';
import { analyseStoredProjectDocument } from '@/server/services/project-document-analysis.service';
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { user, organisation } = await requireOrganisation(context);
  await assertAuthenticatedUploadLimit(context, organisation.id, user.id);
  if (!context.params.id || !context.params.intentId) throw new HttpError(400, 'Project and upload ids are required.');
  const document = await finaliseProjectUpload(organisation.id, context.params.id, context.params.intentId);
  const analysed = document.analysisStatus === 'SUCCESS' ? document : await analyseStoredProjectDocument(document.id, organisation.id);
  return jsonResponse(200, { document: analysed });
}, context);
