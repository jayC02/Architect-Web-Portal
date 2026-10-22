/** Resolve the upload role without changing a document's reviewed classification.
 * Explicit location plans take priority; otherwise the first site/block plan
 * is used, matching the desktop Agent's document bucket selection.
 */
export const resolveLocationPlans = <T>(documents: readonly T[], category: (document: T) => string): T[] => {
  const explicit = documents.filter((document) => category(document) === 'LOCATION_PLAN');
  if (explicit.length) return explicit;
  return documents.filter((document) => ['SITE_PLAN', 'BLOCK_PLAN'].includes(category(document))).slice(0, 1);
};
