export const prerender = false;

import type { APIRoute } from 'astro';
import { COMPLIMENTARY_DEVICE_LIMIT, planLimits } from '@/config/plans';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { organisationAccessSchema } from '@/lib/validation/access';
import { requirePlatformAdmin } from '@/server/billing/admin';

const DAY_MS = 24 * 60 * 60 * 1000;

// Manual overrides for platform admins: comp a workspace, suspend it, extend a
// trial or send it back to the payment wall.
export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const auth = await requirePlatformAdmin(context);
  const body = await parseBody(context.request, organisationAccessSchema);
  const organisationId = context.params.id ?? '';
  const organisation = await prisma.organisation.findUnique({ where: { id: organisationId }, include: { subscription: true } });
  if (!organisation) throw new HttpError(404, 'Organisation not found.');
  const note = `${new Date().toISOString().slice(0, 10)} ${body.action}${body.agentLimit !== undefined ? ` ${body.agentLimit}` : ''} by ${auth.user.email}`;

  const data = (() => {
    switch (body.action) {
      case 'comp':
        return { status: 'COMPLIMENTARY' as const, agentDeviceLimit: Math.max(organisation.subscription?.agentDeviceLimit ?? 1, COMPLIMENTARY_DEVICE_LIMIT) };
      case 'suspend':
        return { status: 'SUSPENDED' as const };
      case 'extend_trial': {
        const base = organisation.subscription?.trialEndsAt && organisation.subscription.trialEndsAt > new Date()
          ? organisation.subscription.trialEndsAt : new Date();
        return { status: 'TRIALING' as const, trialEndsAt: new Date(base.getTime() + (body.days ?? 14) * DAY_MS) };
      }
      case 'require_payment':
        return { status: 'PENDING_PAYMENT' as const };
      case 'set_agent_limit':
        // Customers can ask for more Agent computers than their plan default.
        // Kept through Stripe renewals; a change to a different plan resets it.
        if (body.agentLimit === undefined) throw new HttpError(400, 'Enter the number of Agent computers.');
        return { agentDeviceLimit: body.agentLimit };
      case 'activate_firm':
        // Quoted Firm contracts: invoiced outside self-serve checkout. If you
        // later create the subscription in Stripe with metadata.organisationId,
        // the webhook takes over from here.
        return { ...planLimits('firm'), status: 'ACTIVE' as const, billingInterval: null, currentPeriodEndsAt: null };
    }
  })();

  await prisma.organisationSubscription.upsert({
    where: { organisationId },
    create: { organisationId, source: 'MANUAL', notes: note, status: 'PENDING_PAYMENT', ...data },
    update: { ...data, notes: [organisation.subscription?.notes, note].filter(Boolean).join('\n').slice(-2000) },
  });
  return jsonResponse(200, { ok: true });
}, context);
