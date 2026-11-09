import { z } from 'zod';

// Current supported warrant flow, as confirmed by the application owner.
export const FIXED_WARRANT_ANSWERS = Object.freeze({
  workStartedBeforeApplication: false,
  applicationIsStaged: false,
  intendedLifeFiveYearsOrLess: false,
  restrictPublicInspection: false,
});
export const fixedWarrantAnswerFields = {
  workStartedBeforeApplication: z.preprocess(() => false, z.literal(false)),
  applicationIsStaged: z.preprocess(() => false, z.literal(false)),
  intendedLifeFiveYearsOrLess: z.preprocess(() => false, z.literal(false)),
  restrictPublicInspection: z.preprocess(() => false, z.literal(false)),
};

export const SUSTAINABILITY_LEVELS = ['bronze_active', 'silver', 'silver_active', 'gold', 'platinum'] as const;
export const SUSTAINABILITY_LEVEL_LABELS = ['Bronze Active', 'Silver', 'Silver Active', 'Gold', 'Platinum'];
export const SUSTAINABILITY_ROWS = {
  domestic: ['Carbon dioxide emissions', 'Energy for space heating', 'Energy for water heating', 'Water use efficiency',
    'Optimising performance', 'Adaptability and flexibility', 'Well-being and security', 'Material use and waste'],
  nonDomestic: ['Carbon dioxide emissions', 'Energy (thermal comfort and artificial lighting — schools only)',
    'Water efficiency — schools only', 'Biodiversity', 'Flexibility and adaptability — schools only',
    'Well-being — schools only', 'Material use and waste — schools only', 'Optimising performance — schools only'],
};
const levels = z.array(z.enum(['', ...SUSTAINABILITY_LEVELS])).max(8).superRefine((values, context) => {
  values.forEach((value, row) => {
    if (row > 0 && value !== '' && value !== 'silver' && value !== 'gold') {
      context.addIssue({ code: 'custom', path: [row], message: 'This aspect allows Silver or Gold only.' });
    }
  });
});
export const warrantSustainabilitySchema = z.object({
  higherLevels: z.boolean().optional(),
  multipleBuildings: z.boolean().optional(),
  buildingCount: z.number().int().min(2).max(2147483647).optional(),
  domesticUse: z.boolean().optional(),
  nonDomesticUse: z.boolean().optional(),
  domesticLevels: levels.optional(),
  nonDomesticLevels: levels.optional(),
});
export type WarrantSustainability = z.infer<typeof warrantSustainabilitySchema>;

const optionalBoolean = z.preprocess(value => value === '' || value == null ? undefined
  : value === 'true' || value === 'on' ? true : value === 'false' ? false : value, z.boolean().optional());
const formLevels = z.preprocess(value => value === undefined ? undefined : Array.isArray(value) ? value : [value], levels.optional());
export const warrantFollowUpFormFields = {
  fireAuthorityName: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().max(20).optional()),
  historicalBuildingDetails: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().max(750).optional()),
  dangerousBuildingReferences: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().max(750).optional()),
  relaxationReference: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().max(750).optional()),
  relaxationDate: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().date('Enter a valid relaxation-direction date.').optional()),
  higherLevelsSustainability: optionalBoolean,
  sustainabilityMultipleBuildings: optionalBoolean,
  sustainabilityBuildingCount: z.preprocess(value => value === '' || value == null ? undefined : value, z.coerce.number().int().min(2).max(2147483647).optional()),
  sustainabilityDomesticUse: optionalBoolean,
  sustainabilityNonDomesticUse: optionalBoolean,
  sustainabilityDomesticLevels: formLevels,
  sustainabilityNonDomesticLevels: formLevels,
};
type FormFields = z.infer<ReturnType<typeof followUpFormSchema>>;
const followUpFormSchema = () => z.object(warrantFollowUpFormFields);
export const sustainabilityFromForm = (value: FormFields): WarrantSustainability => ({
  higherLevels: value.higherLevelsSustainability,
  multipleBuildings: value.sustainabilityMultipleBuildings,
  buildingCount: value.sustainabilityBuildingCount,
  domesticUse: value.sustainabilityDomesticUse,
  nonDomesticUse: value.sustainabilityNonDomesticUse,
  domesticLevels: value.sustainabilityDomesticLevels,
  nonDomesticLevels: value.sustainabilityNonDomesticLevels,
});

export const missingSustainabilityAnswers = (value: WarrantSustainability | undefined) => {
  const missing: Array<{ field: string; message: string }> = [];
  const requireAnswer = (field: string, present: boolean, message: string) => {
    if (!present) missing.push({ field: `buildingWarrant.sustainability.${field}`, message });
  };
  requireAnswer('higherLevels', typeof value?.higherLevels === 'boolean', 'Confirm whether the new building is designed for higher levels of sustainability.');
  if (value?.higherLevels !== true) return missing;
  requireAnswer('multipleBuildings', typeof value.multipleBuildings === 'boolean', 'Confirm whether higher sustainability levels cover multiple buildings.');
  if (value.multipleBuildings) requireAnswer('buildingCount', Number.isInteger(value.buildingCount) && value.buildingCount! >= 2, 'Enter the total number of buildings (at least two).');
  requireAnswer('domesticUse', typeof value.domesticUse === 'boolean', 'Confirm domestic use for the sustainability assessment.');
  requireAnswer('nonDomesticUse', typeof value.nonDomesticUse === 'boolean', 'Confirm non-domestic use for the sustainability assessment.');
  requireAnswer('buildingUse', value.domesticUse === true || value.nonDomesticUse === true, 'Select domestic use, non-domestic use, or both.');
  for (const [use, key] of [['domesticUse', 'domesticLevels'], ['nonDomesticUse', 'nonDomesticLevels']] as const) {
    if (value[use]) SUSTAINABILITY_ROWS[key === 'domesticLevels' ? 'domestic' : 'nonDomestic'].forEach((label, row) => {
      const level = value[key]?.[row];
      requireAnswer(`${key}.${row}`, Boolean(level && (row === 0 ? SUSTAINABILITY_LEVELS.includes(level) : level === 'silver' || level === 'gold')), `Choose a ${key === 'domesticLevels' ? 'domestic' : 'non-domestic'} sustainability level for ${label}.`);
    });
  }
  return missing;
};
