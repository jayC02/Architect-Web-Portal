export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { createSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { registerSchema } from '@/lib/validation/auth';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { slugify } from '@/lib/utils/slug';

const resolveOrganisationSlug = async (name: string) => {
  const base = slugify(name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
};

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.auth, 'register');
    const body = await parseBody(context.request, registerSchema);

    const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (existing) throw new HttpError(409, 'A user with that email already exists.');

    const passwordHash = await hashPassword(body.password);
    const organisationSlug = await resolveOrganisationSlug(body.organisationName);

    const user = await prisma.$transaction(async (tx) =>
      tx.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash,
          organisationLinks: {
            create: {
              role: 'OWNER',
              organisation: {
                create: {
                  name: body.organisationName,
                  slug: organisationSlug,
                  calendarConnections: {
                    create: [{ provider: 'GOOGLE' }, { provider: 'OUTLOOK' }],
                  },
                },
              },
            },
          },
        },
        select: { id: true, name: true, email: true },
      }),
    );

    await createSession(user.id, context);
    return jsonResponse(201, { user });
  }, context);