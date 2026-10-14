import type { Prisma } from '@prisma/client';
import type { ApplicationDraftReview } from '@/lib/validation/application-draft';
import { HttpError } from '@/lib/utils/http';

// Called inside project creation's transaction, after readiness validation.
// Draft autosaves never change the shared client directory.
export const saveDraftClientCorrections = async (
  tx: Pick<Prisma.TransactionClient, 'client'>,
  organisationId: string,
  review: ApplicationDraftReview,
) => {
  if (review.projectMode === 'existing' || review.clientMode !== 'existing'
    || !review.existingClientId || !review.clientDetailsEdited) return;
  const { displayName, clientType, ...details } = review.client;
  const result = await tx.client.updateMany({
    where: { id: review.existingClientId, organisationId },
    data: {
      ...details,
      name: displayName!.trim(),
      companyName: clientType === 'ORGANISATION' ? details.companyName : null,
      address: [details.addressLine1, details.addressLine2, details.townCity, details.postcode, details.country]
        .filter(Boolean).join(', ') || null,
    },
  });
  if (!result.count) throw new HttpError(404, 'The selected client is not available.');
};
