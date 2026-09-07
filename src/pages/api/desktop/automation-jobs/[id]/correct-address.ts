export const prerender = false;

import type { APIRoute } from 'astro';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
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

  const { newJob, compatibleAgentOnline } = await restartFailedAutomationJob({
    organisation: access.organisation,
    actor: access.user,
    oldJobId,
    desktopAccess: access,
    correctedPostcode: postcode,
  });
  return jsonResponse(201, {
    ok: true,
    job: { ...newJob, stale: false },
    compatibleAgentOnline,
  });
}, context);
