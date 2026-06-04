import type { OrganisationRole } from '@prisma/client';
import type { APIContext } from 'astro';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

export const requireUser = async (context: APIContext) => {
  const user = await getSessionUser(context);
  if (!user) throw new HttpError(401, 'Authentication required.');
  return user;
};

export const getActiveOrganisationMembership = async (userId: string) => {
  const membership = await prisma.organisationMember.findFirst({
    where: { userId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: { organisation: true },
  });

  if (!membership) throw new HttpError(403, 'No organisation membership found.');
  return membership;
};

export const requireOrganisation = async (context: APIContext) => {
  const user = await requireUser(context);
  const membership = await getActiveOrganisationMembership(user.id);
  return { user, membership, organisation: membership.organisation };
};

export const requireOrganisationRole = async (context: APIContext, allowed: OrganisationRole[]) => {
  const auth = await requireOrganisation(context);
  if (!allowed.includes(auth.membership.role)) {
    throw new HttpError(403, 'Insufficient permissions for this action.');
  }
  return auth;
};

export const requireProjectAccess = async (organisationId: string, projectId: string) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId },
  });

  if (!project) throw new HttpError(404, 'Project not found.');
  return project;
};
