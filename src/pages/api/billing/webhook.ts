export const prerender = false;

import type { APIRoute } from 'astro';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { verifyStripeWebhook } from '@/server/billing/stripe';
import { handleStripeEvent } from '@/server/billing/subscription-sync';

// Stripe -> portal subscription sync. Authenticated by the signature, so it is
// public in the middleware. Idempotent: each event id is processed once.
export const POST: APIRoute = (context) => withErrorHandling(async () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(503, 'Billing webhooks are not configured.');
  const payload = await context.request.text();
  const event = verifyStripeWebhook(payload, context.request.headers.get('stripe-signature'), secret);

  try {
    await prisma.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonResponse(200, { received: true, duplicate: true });
    }
    throw error;
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    // Let Stripe retry: forget the event so the retry is processed.
    await prisma.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    throw error;
  }
  return jsonResponse(200, { received: true });
}, context);
