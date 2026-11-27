// Planning Permission (ePlanning "Planning Permission" form) answers.
//
// Stored in PlanningApplication.preparationData.planningPermission, copied into the
// automation snapshot's planning.answers and read by the desktop Agent
// (automation/planning_permission). The completeness rules here mirror the Agent's
// preflight so a job waits for answers here instead of failing on the desktop.
// Page routing: docs/planning-permission-portal-map.md.
import { z } from 'zod';

export const PLANNING_PERMISSION_KINDS = ['FULL', 'PPP', 'FURTHER', 'AMSC'] as const;
export const PLANNING_PERMISSION_KIND_LABELS: Record<(typeof PLANNING_PERMISSION_KINDS)[number], string> = {
  FULL: 'Planning permission (including change of use)',
  PPP: 'Planning permission in principle',
  FURTHER: 'Further application (renewal, or changing a condition)',
  AMSC: 'Approval of matters specified in conditions',
};
export const WORKS_STARTED = ['No', 'Started', 'Completed'] as const;
export const PRE_APPLICATION_FORMATS = ['Meeting', 'Telephone', 'Letter', 'Email'] as const;
export const SITE_AREA_UNITS = ['sqm', 'ha'] as const;
export const DRAINAGE_CONNECTIONS = ['PUBLIC', 'PRIVATE', 'NOT_APPLICABLE'] as const;
export const PRIVATE_DRAINAGE_TYPES = ['SEPTIC_TANK', 'TREATMENT', 'OTHER'] as const;
export const SEPTIC_TANK_DISCHARGES = ['LAND', 'WATERCOURSE', 'COASTAL'] as const;
export const PUBLIC_WATER_SUPPLIES = ['YES', 'PRIVATE', 'NONE'] as const;
export const YES_NO_DONT_KNOW = ['YES', 'NO', 'DONT_KNOW'] as const;
// The Agent accepts these names (or the portal's option codes).
export const FLOORSPACE_USE_CLASSES = [
  'Class 1 Retail (food)', 'Class 1 Retail (non-food)', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
  'Class 6', 'Class 7', 'Class 8', 'Class 8a', 'Class 10', 'Class 11', 'Not in a use class', "Don't know",
] as const;
export const FLOORSPACE_USE_CLASS_LABELS: Record<(typeof FLOORSPACE_USE_CLASSES)[number], string> = {
  'Class 1 Retail (food)': 'Class 1 Retail (food)',
  'Class 1 Retail (non-food)': 'Class 1 Retail (non-food)',
  'Class 2': 'Class 2 Financial, professional and other services',
  'Class 3': 'Class 3 Restaurant/cafe',
  'Class 4': 'Class 4 Business (office/light industry)',
  'Class 5': 'Class 5 General industry',
  'Class 6': 'Class 6 Storage or distribution',
  'Class 7': 'Class 7 Hotels and hostels',
  'Class 8': 'Class 8 Residential institutions',
  'Class 8a': 'Class 8a Secure residential institutions',
  'Class 10': 'Class 10 Non-residential institutions',
  'Class 11': 'Class 11 Assembly and leisure',
  'Not in a use class': 'Not in a use class',
  "Don't know": "Don't know",
};
export const FLOORSPACE_ROWS = 3;

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const optionalNullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional();
const longText = optionalNullable(z.string().trim().max(500));
const shortText = (max: number) => optionalNullable(z.string().trim().max(max));
const ukDate = optionalNullable(z.string().trim().regex(DATE, 'Enter the date as dd/mm/yyyy.'));
const yesNo = optionalNullable(z.boolean());

export const floorspaceEntrySchema = z.object({
  useClass: z.enum(FLOORSPACE_USE_CLASSES),
  grossFloorspace: z.number().positive().max(99999999),
  netTradingSpace: optionalNullable(z.number().nonnegative().max(99999999)),
  nonTradingSpace: optionalNullable(z.number().nonnegative().max(99999999)),
  details: longText,
});

/** Stored and snapshot shape. Every answer is optional: completeness is a preflight concern. */
export const planningPermissionAnswersSchema = z.object({
  applicationKind: optionalNullable(z.enum(PLANNING_PERMISSION_KINDS)),
  earlierApplicationReference: shortText(120),
  earlierApplicationDate: ukDate,
  temporaryPermission: yesNo,
  temporaryPermissionDetails: longText,
  changeOfUseTakenPlace: yesNo,
  worksStarted: optionalNullable(z.enum(WORKS_STARTED)),
  worksDate: ukDate,
  worksReason: longText,
  preApplicationFormat: optionalNullable(z.enum(PRE_APPLICATION_FORMATS)),
  preApplicationFeedback: longText,
  preApplicationOfficerFirstName: shortText(100),
  preApplicationOfficerLastName: shortText(100),
  preApplicationReference: shortText(120),
  preApplicationDate: ukDate,
  siteArea: optionalNullable(z.number().positive().max(99999999)),
  siteAreaUnit: optionalNullable(z.enum(SITE_AREA_UNITS)),
  existingUse: longText,
  publicPathsChanges: yesNo,
  waterOrDrainageChanges: yesNo,
  drainageConnection: optionalNullable(z.enum(DRAINAGE_CONNECTIONS)),
  privateDrainageType: optionalNullable(z.enum(PRIVATE_DRAINAGE_TYPES)),
  septicTankDischarge: optionalNullable(z.enum(SEPTIC_TANK_DISCHARGES)),
  privateDrainageDetails: longText,
  sustainableDrainage: yesNo,
  publicWaterSupply: optionalNullable(z.enum(PUBLIC_WATER_SUPPLIES)),
  knownFloodRisk: optionalNullable(z.enum(YES_NO_DONT_KNOW)),
  increasesFloodRisk: optionalNullable(z.enum(YES_NO_DONT_KNOW)),
  floodRiskDetails: longText,
  wasteStorage: yesNo,
  wasteDetails: longText,
  newDwellings: yesNo,
  dwellingUnits: optionalNullable(z.number().int().positive().max(99999)),
  nonResidentialFloorspace: yesNo,
  floorspaceEntries: optionalNullable(z.array(floorspaceEntrySchema).max(20)),
  schedule3: optionalNullable(z.enum(YES_NO_DONT_KNOW)),
  staffOrMemberInterest: yesNo,
  staffOrMemberInterestDetails: longText,
});
export type PlanningPermissionAnswers = z.infer<typeof planningPermissionAnswersSchema>;

/** Read stored answers, dropping anything that no longer validates. */
export const readPlanningPermissionAnswers = (value: unknown): PlanningPermissionAnswers => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const answers: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(planningPermissionAnswersSchema.shape)) {
    const parsed = (schema as z.ZodTypeAny).safeParse(source[key]);
    if (parsed.success && parsed.data !== undefined) answers[key] = parsed.data;
  }
  return answers as PlanningPermissionAnswers;
};

// ---- form ---------------------------------------------------------------
// Fields are prefixed "pp_" so they cannot collide with the shared planning questions.
const formText = (max: number) => z.preprocess(
  value => (typeof value === 'string' && value.trim() === '') || value == null ? undefined : value,
  z.string().trim().max(max).optional(),
);
const floorspaceFormFields = Object.fromEntries(
  Array.from({ length: FLOORSPACE_ROWS }, (_, row) => [
    [`pp_floorspace_${row}_useClass`, formText(60)],
    [`pp_floorspace_${row}_gross`, formText(20)],
    [`pp_floorspace_${row}_netTrading`, formText(20)],
    [`pp_floorspace_${row}_nonTrading`, formText(20)],
    [`pp_floorspace_${row}_details`, formText(500)],
  ]).flat(),
) as Record<string, ReturnType<typeof formText>>;

export const planningPermissionFormSchema = z.object({
  pp_section: formText(10),
  pp_applicationKind: formText(10),
  pp_earlierApplicationReference: formText(120),
  pp_earlierApplicationDate: formText(10),
  pp_temporaryPermission: formText(5),
  pp_temporaryPermissionDetails: formText(500),
  pp_changeOfUseTakenPlace: formText(5),
  pp_worksStarted: formText(10),
  pp_worksDate: formText(10),
  pp_worksReason: formText(500),
  pp_preApplicationFormat: formText(10),
  pp_preApplicationFeedback: formText(500),
  pp_preApplicationOfficerFirstName: formText(100),
  pp_preApplicationOfficerLastName: formText(100),
  pp_preApplicationReference: formText(120),
  pp_preApplicationDate: formText(10),
  pp_siteArea: formText(20),
  pp_siteAreaUnit: formText(5),
  pp_existingUse: formText(500),
  pp_publicPathsChanges: formText(5),
  pp_waterOrDrainageChanges: formText(5),
  pp_drainageConnection: formText(20),
  pp_privateDrainageType: formText(20),
  pp_septicTankDischarge: formText(20),
  pp_privateDrainageDetails: formText(500),
  pp_sustainableDrainage: formText(5),
  pp_publicWaterSupply: formText(10),
  pp_knownFloodRisk: formText(10),
  pp_increasesFloodRisk: formText(10),
  pp_floodRiskDetails: formText(500),
  pp_wasteStorage: formText(5),
  pp_wasteDetails: formText(500),
  pp_newDwellings: formText(5),
  pp_dwellingUnits: formText(10),
  pp_nonResidentialFloorspace: formText(5),
  pp_schedule3: formText(10),
  pp_staffOrMemberInterest: formText(5),
  pp_staffOrMemberInterestDetails: formText(500),
  ...floorspaceFormFields,
});
export type PlanningPermissionForm = z.infer<typeof planningPermissionFormSchema>;

const formBool = (value: string | undefined) => value === 'true' ? true : value === 'false' ? false : null;
const formNumber = (value: string | undefined) => {
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new z.ZodError([{ code: 'custom', path: [], message: `Enter a number instead of "${value}".` }]);
  return number;
};

/**
 * Turn the submitted form into stored answers. Follow-up answers that the chosen
 * route never asks for are cleared, so a stale answer cannot reach the portal.
 * Returns null when the page did not include the Planning Permission section.
 */
export const planningPermissionAnswersFromForm = (form: PlanningPermissionForm): PlanningPermissionAnswers | null => {
  if (form.pp_section !== 'true') return null;
  const kind = form.pp_applicationKind ?? 'FULL';
  const temporary = formBool(form.pp_temporaryPermission);
  const works = form.pp_worksStarted ?? 'No';
  const water = formBool(form.pp_waterOrDrainageChanges);
  const connection = water ? form.pp_drainageConnection ?? null : null;
  const privateType = connection === 'PRIVATE' ? form.pp_privateDrainageType ?? null : null;
  const increases = form.pp_increasesFloodRisk ?? null;
  const fullOrMatters = kind === 'FULL' || kind === 'AMSC';
  const newDwellings = fullOrMatters ? formBool(form.pp_newDwellings) : null;
  const floorspace = kind !== 'AMSC' ? formBool(form.pp_nonResidentialFloorspace) : null;
  const staff = formBool(form.pp_staffOrMemberInterest);
  const formRecord = form as Record<string, string | undefined>;
  const entries = floorspace
    ? Array.from({ length: FLOORSPACE_ROWS }, (_, row) => ({
        useClass: formRecord[`pp_floorspace_${row}_useClass`],
        grossFloorspace: formNumber(formRecord[`pp_floorspace_${row}_gross`]),
        netTradingSpace: formNumber(formRecord[`pp_floorspace_${row}_netTrading`]),
        nonTradingSpace: formNumber(formRecord[`pp_floorspace_${row}_nonTrading`]),
        details: formRecord[`pp_floorspace_${row}_details`] ?? null,
      })).filter(entry => entry.useClass || entry.grossFloorspace !== null)
    : null;

  return planningPermissionAnswersSchema.parse({
    applicationKind: kind,
    earlierApplicationReference: kind === 'FURTHER' || kind === 'AMSC' ? form.pp_earlierApplicationReference ?? null : null,
    earlierApplicationDate: kind === 'FURTHER' || kind === 'AMSC' ? form.pp_earlierApplicationDate ?? null : null,
    temporaryPermission: temporary ?? false,
    temporaryPermissionDetails: temporary ? form.pp_temporaryPermissionDetails ?? null : null,
    changeOfUseTakenPlace: formBool(form.pp_changeOfUseTakenPlace) ?? false,
    worksStarted: works,
    worksDate: works !== 'No' ? form.pp_worksDate ?? null : null,
    worksReason: works !== 'No' ? form.pp_worksReason ?? null : null,
    preApplicationFormat: form.pp_preApplicationFormat ?? null,
    preApplicationFeedback: form.pp_preApplicationFeedback ?? null,
    preApplicationOfficerFirstName: form.pp_preApplicationOfficerFirstName ?? null,
    preApplicationOfficerLastName: form.pp_preApplicationOfficerLastName ?? null,
    preApplicationReference: form.pp_preApplicationReference ?? null,
    preApplicationDate: form.pp_preApplicationDate ?? null,
    siteArea: formNumber(form.pp_siteArea),
    siteAreaUnit: form.pp_siteAreaUnit ?? 'sqm',
    existingUse: form.pp_existingUse ?? null,
    publicPathsChanges: formBool(form.pp_publicPathsChanges) ?? false,
    waterOrDrainageChanges: water,
    drainageConnection: connection,
    privateDrainageType: privateType,
    septicTankDischarge: privateType === 'SEPTIC_TANK' ? form.pp_septicTankDischarge ?? null : null,
    privateDrainageDetails: connection === 'PRIVATE' ? form.pp_privateDrainageDetails ?? null : null,
    sustainableDrainage: formBool(form.pp_sustainableDrainage),
    publicWaterSupply: form.pp_publicWaterSupply ?? null,
    knownFloodRisk: form.pp_knownFloodRisk ?? null,
    increasesFloodRisk: increases,
    floodRiskDetails: increases === 'YES' ? form.pp_floodRiskDetails ?? null : null,
    wasteStorage: fullOrMatters ? formBool(form.pp_wasteStorage) : null,
    wasteDetails: fullOrMatters ? form.pp_wasteDetails ?? null : null,
    newDwellings,
    dwellingUnits: newDwellings ? formNumber(form.pp_dwellingUnits) : null,
    nonResidentialFloorspace: floorspace,
    floorspaceEntries: entries,
    schedule3: form.pp_schedule3 ?? null,
    staffOrMemberInterest: staff ?? false,
    staffOrMemberInterestDetails: staff ? form.pp_staffOrMemberInterestDetails ?? null : null,
  });
};

// ---- completeness (mirrors the Agent's preflight) --------------------------
export type PlanningPermissionGap = { field: string; message: string };

type Context = {
  discussedWithPlanningAuthority: boolean;
  currentParkingSpaces: number | null;
  proposedParkingSpaces: number | null;
  soleOwner: boolean | null;
  agriculturalHolding: boolean | null;
};

const blank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

export const missingPlanningPermissionAnswers = (
  answers: PlanningPermissionAnswers,
  context: Context,
): PlanningPermissionGap[] => {
  const gaps: PlanningPermissionGap[] = [];
  const need = (field: string, value: unknown, message: string) => {
    if (blank(value)) gaps.push({ field: `planning.answers.${field}`, message });
  };
  const kind = answers.applicationKind ?? 'FULL';
  if (kind === 'FURTHER' || kind === 'AMSC') {
    need('earlierApplicationReference', answers.earlierApplicationReference, 'Enter the reference of the earlier planning application.');
    need('earlierApplicationDate', answers.earlierApplicationDate, 'Enter the date of the earlier planning application.');
  }
  if (answers.temporaryPermission) need('temporaryPermissionDetails', answers.temporaryPermissionDetails, 'Say how long temporary permission is needed for, and why.');
  if (answers.worksStarted && answers.worksStarted !== 'No') {
    need('worksDate', answers.worksDate, 'Enter the date the works started or were completed.');
    need('worksReason', answers.worksReason, 'Explain why work started before applying.');
  }
  if (context.discussedWithPlanningAuthority) {
    need('preApplicationFormat', answers.preApplicationFormat, 'Choose how the planning authority gave its pre-application feedback.');
    need('preApplicationFeedback', answers.preApplicationFeedback, 'Describe the pre-application feedback and who gave it.');
  }
  need('siteArea', answers.siteArea, 'Enter the site area.');
  need('existingUse', answers.existingUse, 'Describe the current or most recent use of the site.');
  if (kind !== 'PPP') {
    need('currentParkingSpaces', context.currentParkingSpaces, 'Enter how many parking spaces exist on the site now (0 if none).');
    need('proposedParkingSpaces', context.proposedParkingSpaces, 'Enter how many parking spaces there will be on the site (0 if none).');
  }
  need('waterOrDrainageChanges', answers.waterOrDrainageChanges, 'Say whether the proposal needs new or altered water supply or drainage.');
  if (answers.waterOrDrainageChanges) {
    need('drainageConnection', answers.drainageConnection, 'Say how the drainage will connect.');
    if (answers.drainageConnection === 'PRIVATE') {
      need('privateDrainageType', answers.privateDrainageType, 'Choose the private drainage arrangement.');
      if (answers.privateDrainageType === 'SEPTIC_TANK') need('septicTankDischarge', answers.septicTankDischarge, 'Say where the septic tank discharges.');
      need('privateDrainageDetails', answers.privateDrainageDetails, 'Describe the private drainage arrangements.');
    }
  }
  need('sustainableDrainage', answers.sustainableDrainage, 'Say whether the plans provide sustainable drainage of surface water (SUDS).');
  need('publicWaterSupply', answers.publicWaterSupply, 'Say how the site connects to a water supply.');
  need('knownFloodRisk', answers.knownFloodRisk, 'Say whether the site is in an area of known flood risk.');
  need('increasesFloodRisk', answers.increasesFloodRisk, 'Say whether the proposal may increase flood risk elsewhere.');
  if (answers.increasesFloodRisk === 'YES') need('floodRiskDetails', answers.floodRiskDetails, 'Describe how flood risk might increase elsewhere.');
  if (kind === 'FULL' || kind === 'AMSC') {
    need('wasteStorage', answers.wasteStorage, 'Say whether the plans include waste and recycling storage.');
    need('wasteDetails', answers.wasteDetails, 'Describe the waste storage and collection arrangements.');
    need('newDwellings', answers.newDwellings, 'Say whether the proposal includes new houses or flats.');
    if (answers.newDwellings) need('dwellingUnits', answers.dwellingUnits, 'Enter how many houses or flats are proposed.');
  }
  if (kind !== 'AMSC') {
    need('nonResidentialFloorspace', answers.nonResidentialFloorspace, 'Say whether the proposal creates or alters non-residential floorspace.');
    if (answers.nonResidentialFloorspace) {
      if (!answers.floorspaceEntries?.length) {
        gaps.push({ field: 'planning.answers.floorspaceEntries', message: 'Add at least one non-residential floorspace entry.' });
      }
      answers.floorspaceEntries?.forEach((entry, index) => {
        if ((entry.useClass === 'Not in a use class' || entry.useClass === "Don't know") && blank(entry.details)) {
          gaps.push({ field: `planning.answers.floorspaceEntries.${index}.details`, message: `Add details for floorspace entry ${index + 1}.` });
        }
      });
    }
  }
  need('schedule3', answers.schedule3, 'Say whether the proposal is Schedule 3 development.');
  if (answers.staffOrMemberInterest) need('staffOrMemberInterestDetails', answers.staffOrMemberInterestDetails, 'Give details of the planning staff or elected member interest.');

  // The Agent can only complete Certificate A automatically for now (see the portal map).
  if (context.agriculturalHolding === true) {
    gaps.push({ field: 'planning.answers.agriculturalHolding', message: 'Planning Permission automation cannot yet complete the certificate for land in an agricultural holding. Prepare this application manually in the portal.' });
  }
  if (context.soleOwner === false) {
    gaps.push({ field: 'planning.answers.soleOwner', message: 'Planning Permission automation can currently complete the certificate only when the applicant is the sole owner. Prepare this application manually in the portal.' });
  }
  return gaps;
};
