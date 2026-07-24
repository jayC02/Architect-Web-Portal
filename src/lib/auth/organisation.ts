import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { slugify } from '@/lib/utils/slug';

type OrganisationLookup = Pick<Prisma.TransactionClient, 'organisation'> | typeof prisma;

export const resolveOrganisationSlug = async (name: string, db: OrganisationLookup = prisma) => {
  const base = slugify(name) || 'practice';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
};
