import type { ApplicationDraftReview } from '@/lib/validation/application-draft';
import { normaliseUkAddress } from '@/lib/addresses/uk-address';

/** Also repair older prepared drafts when opened, without changing linked site records. */
export const normaliseDraftAddresses = (review: ApplicationDraftReview): ApplicationDraftReview => {
  const site = review.siteMode === 'create' ? normaliseUkAddress(review.site) : review.site;
  let client = normaliseUkAddress(review.client);
  if (review.clientAddressSameAsSite) {
    const { localAuthority: _authority, ...address } = site;
    client = { ...client, ...address };
  }
  const applicant = review.applicantDifferentFromClient && review.applicant
    ? normaliseUkAddress(review.applicant) : client;
  const next = { ...review, site, client, applicant };
  return JSON.stringify(next) === JSON.stringify(review) ? review : next;
};
