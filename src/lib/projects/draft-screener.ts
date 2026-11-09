import type { ApplicationDraftReview } from '@/lib/validation/application-draft';
import { readProjectScreener } from '@/lib/projects/screener';

export const applyProjectScreenerToDraftReview = (
  review: ApplicationDraftReview,
  project: { name?: string; buildingUse?: unknown; typeOfWorkKeys?: unknown; projectType?: unknown },
): ApplicationDraftReview => {
  const screener = readProjectScreener(project);
  return {
    ...review,
    project: { ...review.project, name: project.name ?? review.project.name, buildingUse: screener.buildingUse, typeOfWorkKey: screener.typeOfWorkKeys[0] ?? null },
    application: { ...review.application, typeOfWorkKeys: screener.typeOfWorkKeys, presetKey: screener.typeOfWorkKeys[0] ?? null },
  };
};
