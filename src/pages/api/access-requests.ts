export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { accessRequestSchema } from '@/lib/validation/access';
import { platformAdminEmails } from '@/server/billing/access';
import { sendAccessRequestNotification } from '@/server/services/email.service';

const accessRequestPolicy = { name: 'access-request', windowMs: 60 * 60 * 1000, max: 5 };

// Public "Book a demo" endpoint. Creates a pending request for a platform
// admin to approve at /admin/access; never grants access by itself.
export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, accessRequestPolicy, 'access-request');
  const { website, ...body } = await parseBody(context.request, accessRequestSchema);
  if (website) return jsonResponse(201, { ok: true });

  const recent = await prisma.accessRequest.findFirst({
    where: { email: body.email, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  if (!recent) {
    await prisma.accessRequest.create({ data: { ...body, ipAddress: context.clientAddress ?? null } });
    void sendAccessRequestNotification(platformAdminEmails(), body).catch((error) => console.error('Access request notification failed', error));
  }
  // Same response either way so the form can't be used to probe emails.
  return jsonResponse(201, { ok: true });
}, context);
