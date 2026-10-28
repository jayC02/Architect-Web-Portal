import type { Prisma } from '@prisma/client';

// Presence is separate from approval: draft/review plans still need their
// existing review checks, while rejected and superseded records cannot fill the role.
export const locationPlanPresenceWhere = {
  type: { in: ['LOCATION_PLAN', 'SITE_PLAN', 'BLOCK_PLAN'] },
  status: { notIn: ['REJECTED', 'SUPERSEDED'] },
} satisfies Prisma.ProjectDocumentWhereInput;

export const hasLocationPlanDocument = (documents: readonly { type: string; status: string }[]) =>
  documents.some((document) =>
    locationPlanPresenceWhere.type.in.some((type) => type === document.type)
    && !locationPlanPresenceWhere.status.notIn.some((status) => status === document.status));

/** Resolve the upload role without changing a document's reviewed classification.
 * Explicit location plans take priority; otherwise the first site/block plan
 * is used, matching the desktop Agent's document bucket selection.
 */
export const resolveLocationPlans = <T>(documents: readonly T[], category: (document: T) => string): T[] => {
  const explicit = documents.filter((document) => category(document) === 'LOCATION_PLAN');
  if (explicit.length) return explicit;
  return documents.filter((document) => ['SITE_PLAN', 'BLOCK_PLAN'].includes(category(document))).slice(0, 1);
};
