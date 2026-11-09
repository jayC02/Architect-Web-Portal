import { z } from 'zod';
import { TYPE_OF_WORK_KEYS, TYPE_OF_WORK_DEFINITIONS, type TypeOfWorkKey } from '@/lib/projects/type-of-work';

export const BUILDING_USES = ['residential', 'commercial'] as const;
export const buildingUseSchema = z.enum(BUILDING_USES, { errorMap: () => ({ message: 'Choose Residential or Commercial for the project.' }) });
export type BuildingUse = z.infer<typeof buildingUseSchema>;
const workTypeSchema = z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]]);
export const projectWorkTypesSchema = z.preprocess(
  value => value === undefined || value === null || value === '' ? [] : Array.isArray(value) ? value : [value],
  z.array(workTypeSchema).min(1, 'Select at least one type of work.').max(TYPE_OF_WORK_KEYS.length),
).transform(values => [...new Set(values)]);

export const projectScreenerFields = {
  buildingUse: buildingUseSchema,
  typeOfWorkKeys: projectWorkTypesSchema,
};
export const projectScreenerOptionalFields = {
  buildingUse: buildingUseSchema.optional(),
  typeOfWorkKeys: projectWorkTypesSchema.optional(),
};
export const projectScreenerUpdateSchema = z.object(projectScreenerFields).transform(value => ({
  ...value,
  // Keep older consumers of the singular project type in agreement.
  projectType: value.typeOfWorkKeys[0],
}));

const knownLegacyWorkType = (value: unknown): TypeOfWorkKey | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalised = value.trim().toLowerCase();
  return TYPE_OF_WORK_DEFINITIONS.find(type => type.key === normalised || type.label.toLowerCase() === normalised)?.key;
};

export const readProjectScreener = (project: {
  buildingUse?: unknown;
  typeOfWorkKeys?: unknown;
  projectType?: unknown;
}) => {
  const use = buildingUseSchema.safeParse(project.buildingUse);
  const storedTypes = projectWorkTypesSchema.safeParse(project.typeOfWorkKeys);
  const legacyType = knownLegacyWorkType(project.projectType);
  const emptyStored = project.typeOfWorkKeys == null || (Array.isArray(project.typeOfWorkKeys) && !project.typeOfWorkKeys.length);
  const typeOfWorkKeys = storedTypes.success ? storedTypes.data : emptyStored && legacyType ? [legacyType] : [];
  return {
    buildingUse: use.success ? use.data : null,
    typeOfWorkKeys,
    complete: use.success && typeOfWorkKeys.length > 0,
  };
};
