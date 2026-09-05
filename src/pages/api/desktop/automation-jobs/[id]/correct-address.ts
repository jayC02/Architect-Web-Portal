export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { desktopAddressCorrectionSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { assertDesktopJobAccess, requireDesktopAuth } from '@/server/auth/desktop-token';
import { restartFailedAutomationJob } from '@/server/services/automation-job-restart.service';

const normalisePostcode = (value: string) => {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
};

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-job:correct-address');
  const access = await requireDesktopAuth(context);
  const oldJobId = context.params.id;
  if (!oldJobId) throw new HttpError(400, 'Automation job id is required.');
  assertDesktopJobAccess(access, oldJobId);
  const body = await parseBody(context.request, desktopAddressCorrectionSchema);
  const postcode = normalisePostcode(body.postcode);
  if (!/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) {
    throw new HttpError(400, 'Enter a valid UK postcode.');
  }

  const oldJob = await prisma.automationJob.findFirst({
    where: {
      id: oldJobId,
      organisationId: access.organisationId,
      claimedDeviceId: access.id,
      status: AutomationJobStatus.FAILED_RETRYABLE,
    },
    select: { projectId: true, dataSnapshot: true },
  });
  if (!oldJob) {
    throw new HttpError(409, 'The address correction is no longer attached to this failed automation attempt.');
  }
  const snapshot = automationJobSnapshotV2Schema.safeParse(oldJob.dataSnapshot);
  if (!snapshot.success || !snapshot.data.site.id) {
    throw new HttpError(409, 'This automation attempt does not contain an exact Site record to correct safely.');
  }

  const updated = await prisma.site.updateMany({
    where: {
      id: snapshot.data.site.id,
      organisationId: access.organisationId,
      projects: { some: { id: oldJob.projectId, organisationId: access.organisationId } },
    },
    data: { postcode },
  });
  if (!updated.count) throw new HttpError(404, 'The project Site could not be updated.');

  const { newJob, compatibleAgentOnline } = await restartFailedAutomationJob({
    organisation: access.organisation,
    actor: access.user,
    oldJobId,
  });
  return jsonResponse(201, {
    ok: true,
    job: { ...newJob, stale: false },
    compatibleAgentOnline,
  });
}, context);
