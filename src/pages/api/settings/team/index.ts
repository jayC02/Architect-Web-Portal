export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { absoluteUrl } from '@/lib/config';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { createTeamInvite, listTeam } from '@/server/billing/team';
import { sendTeamInviteEmail } from '@/server/services/email.service';

const inviteSchema = z.object({
  email: z.string().trim().email().max(200).transform((value) => value.toLowerCase()),
  role: z.enum(['MEMBER', 'ADMIN']).default('MEMBER'),
});

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return jsonResponse(200, await listTeam(organisation.id));
}, context);

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'team:invite');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const body = await parseBody(context.request, inviteSchema);
  const { invite, token } = await createTeamInvite({
    organisationId: organisation.id, email: body.email, role: body.role, invitedById: user.id,
  });
  const inviteUrl = absoluteUrl(`/register?team=${encodeURIComponent(token)}`);
  let emailed = false;
  try {
    emailed = await sendTeamInviteEmail(invite.email, { practiceName: organisation.name, invitedBy: user.name, inviteUrl });
  } catch (error) {
    console.error('Team invite email could not be sent', { organisationId: organisation.id, error });
  }
  // The link is returned too, so it can be shared another way if email isn't set up.
  return jsonResponse(201, { invite, inviteUrl, emailed });
}, context);
