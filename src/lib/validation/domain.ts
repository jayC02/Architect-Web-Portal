import {
  CompletionCertificateStatus,
  DeadlinePriority,
  DeadlineStatus,
  DeadlineType,
  DocumentStatus,
  DocumentSortBatchStatus,
  DocumentType,
  PlanningStatus,
  ProjectStage,
  ProjectStatus,
  SubmissionPackageStatus,
  SubmissionPackageType,
  WarrantStatus,
  WarrantType,
} from '@prisma/client';
import { z } from 'zod';
import {
  TYPE_OF_WORK_KEYS,
  TYPE_OF_WORK_OPTIONS,
  type TypeOfWorkKey,
  typeOfWorkKey,
} from '@/lib/projects/type-of-work';
import { emptyToUndefined, optionalDate, optionalText, safeUrl } from '@/lib/validation/common';
import { blankContactToUndefined, isValidUkPhone } from '@/lib/validation/client-contact';
import { certifierRegistrationPart1Schema } from '@/lib/certifier-registration';

export const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.preprocess(
    blankContactToUndefined,
    z
      .string()
      .trim()
      .max(160)
      .email('Enter a valid email address.')
      .transform((value) => value.toLowerCase())
      .optional(),
  ),
  phone: z.preprocess(
    blankContactToUndefined,
    z
      .string()
      .trim()
      .max(30, 'Enter a valid phone number.')
      .refine(isValidUkPhone, 'Enter a valid phone number.')
      .optional(),
  ),
  address: optionalText(500),
  notes: optionalText(2000),
  title: optionalText(40),
  firstName: optionalText(100),
  lastName: optionalText(100),
  companyName: optionalText(160),
  buildingNumber: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  townCity: optionalText(100),
  postcode: optionalText(20),
  country: optionalText(100),
});

export const siteSchema = z.object({
  buildingNumber: optionalText(40),
  addressLine1: z.string().trim().min(1).max(160),
  addressLine2: optionalText(160),
  townCity: z.string().trim().min(1).max(100),
  postcode: z.string().trim().min(2).max(20),
  localAuthority: optionalText(120),
  notes: optionalText(2000),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  internalReference: optionalText(80),
  projectType: optionalText(120),
  stage: z.nativeEnum(ProjectStage).default(ProjectStage.LEAD),
  localAuthority: optionalText(120),
  clientId: optionalText(80),
  siteId: optionalText(80),
  siteAddress: optionalText(500),
  status: z.nativeEnum(ProjectStatus).default(ProjectStatus.ACTIVE),
  notes: optionalText(4000),
});

export const projectCreateSchema = projectSchema
  .omit({ stage: true, status: true, siteAddress: true, projectType: true })
  .extend({
    name: optionalText(160),
    projectType: z.preprocess(
      (value) => {
        const cleaned = emptyToUndefined(value);
        if (typeof cleaned !== 'string') return cleaned;
        const normalised = cleaned.trim().toLowerCase();
        const supported = TYPE_OF_WORK_KEYS.includes(normalised as TypeOfWorkKey)
          || TYPE_OF_WORK_OPTIONS.some((label) => label.toLowerCase() === normalised);
        return supported ? typeOfWorkKey(cleaned) : cleaned;
      },
      z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]]).optional(),
    ),
  })
  .transform((project) => ({
    ...project,
    stage: ProjectStage.LEAD,
    status: ProjectStatus.ACTIVE,
    siteAddress: undefined,
  }));

const yesNoAnswer = z.boolean().default(false);
const formBoolean = z.preprocess((value) => {
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false') return false;
  return value;
}, z.boolean());
const formCheckboxBoolean = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on',
  z.boolean(),
);
export const typeOfWorkKeysSchema = z.preprocess(
  (value) => Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value],
  z.array(z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]])).min(1, 'Select at least one type of work.').max(TYPE_OF_WORK_KEYS.length),
);
const optionalNonNegativeInteger = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.coerce.number().int().nonnegative().optional(),
);
const optionalNonNegativeMoney = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.coerce.number().nonnegative().max(9999999999.99).optional(),
);

export const buildingWarrantPreparationSchema = z.object({
  applicantIsOwner: yesNoAnswer.default(true),
  workStartedBeforeApplication: z.boolean().optional(),
  disabledPersonsFacilitiesOnly: z.boolean().optional(),
  certifierOfDesignCertificateAvailable: z.boolean().optional(),
  certifierOfConstructionCertificateAvailable: z.boolean().optional(),
  applicationIsStaged: yesNoAnswer,
  intendedLifeFiveYearsOrLess: yesNoAnswer,
  fireAndRescueServiceEnforcingAuthority: yesNoAnswer.default(true),
  listedBuildingOrConservationArea: yesNoAnswer,
  otherHistoricalImportance: yesNoAnswer,
  scottishMinistersRelaxationDirection: yesNoAnswer,
  dangerousBuildingNotice: yesNoAnswer,
  approvedCertifierOfConstruction: yesNoAnswer,
  coveredBySTAS: yesNoAnswer,
  restrictPublicInspection: yesNoAnswer,
});

export const BUILDING_WARRANT_CONFIRMATION_DEFAULTS = Object.freeze(
  buildingWarrantPreparationSchema.parse({}),
);

export const householderPreparationSchema = z.object({
  discussedWithPlanningAuthority: yesNoAnswer,
  treesOnOrAdjacentToSite: yesNoAnswer,
  newOrAlteredVehicleAccess: yesNoAnswer,
  currentParkingSpaces: z.coerce.number().int().nonnegative().optional(),
  proposedParkingSpaces: z.coerce.number().int().nonnegative().optional(),
  soleOwner: z.boolean().optional(),
  agriculturalHolding: z.boolean().optional(),
}).superRefine((value, context) => {
  if (!value.newOrAlteredVehicleAccess) return;
  if (value.currentParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['currentParkingSpaces'], message: 'Enter the current parking spaces.' });
  }
  if (value.proposedParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['proposedParkingSpaces'], message: 'Enter the proposed parking spaces.' });
  }
});

export const householderPreparationUpdateSchema = z.object({
  description: optionalText(500),
  discussedWithPlanningAuthority: formBoolean,
  treesOnOrAdjacentToSite: formBoolean,
  newOrAlteredVehicleAccess: formBoolean,
  currentParkingSpaces: optionalNonNegativeInteger,
  proposedParkingSpaces: optionalNonNegativeInteger,
  soleOwner: formBoolean,
  agriculturalHolding: formBoolean,
}).superRefine((value, context) => {
  if (!value.newOrAlteredVehicleAccess) return;
  if (value.currentParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['currentParkingSpaces'], message: 'Enter the current parking spaces.' });
  }
  if (value.proposedParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['proposedParkingSpaces'], message: 'Enter the proposed parking spaces.' });
  }
});

export const planningPreparationDetailsSchema = z.object({
  jobId: optionalText(120),
  applicationReference: optionalText(120),
  submissionDate: optionalDate,
  validDate: optionalDate,
  decisionTargetDate: optionalDate,
  decisionDate: optionalDate,
  status: z.nativeEnum(PlanningStatus).optional(),
  portalUrl: safeUrl,
  notes: optionalText(3000),
}).and(householderPreparationUpdateSchema);

export const buildingWarrantPreparationUpdateSchema = z.object({
  description: optionalText(2000),
  estimatedValue: optionalNonNegativeMoney,
  currentUse: optionalText(160),
  proposedUse: optionalText(160),
  typeOfWorkKeys: typeOfWorkKeysSchema,
  selectedCertifierPresetId: optionalText(120),
  workStartedBeforeApplication: formBoolean.optional(),
  disabledPersonsFacilitiesOnly: formBoolean.optional(),
  certifierOfDesignCertificateAvailable: formBoolean.optional(),
  certifierOfConstructionCertificateAvailable: formBoolean.optional(),
  applicantIsOwner: formBoolean,
  applicationIsStaged: formBoolean,
  intendedLifeFiveYearsOrLess: formBoolean,
  fireAndRescueServiceEnforcingAuthority: formBoolean,
  listedBuildingOrConservationArea: formBoolean,
  otherHistoricalImportance: formBoolean,
  scottishMinistersRelaxationDirection: formBoolean,
  dangerousBuildingNotice: formBoolean,
  approvedCertifierOfConstruction: formBoolean,
  coveredBySTAS: formBoolean,
  restrictPublicInspection: formBoolean,
});

export const buildingWarrantCertifierDetailsSchema = z.object({
  jobId: optionalText(120),
  warrantReference: optionalText(120),
  warrantType: z.nativeEnum(WarrantType).optional(),
  submissionDate: optionalDate,
  firstResponseTargetDate: optionalDate,
  grantedDate: optionalDate,
  expiryDate: optionalDate,
  completionCertificateStatus: z.nativeEnum(CompletionCertificateStatus).optional(),
  status: z.nativeEnum(WarrantStatus).optional(),
  portalUrl: safeUrl,
  notes: optionalText(3000),
  typeOfWorkKeys: typeOfWorkKeysSchema,
  description: z.string().trim().min(1, 'Enter a description of the Building Warrant work.').max(2000),
  estimatedValue: z.coerce.number().positive('Enter an estimated value greater than zero.'),
  currentUse: z.string().trim().min(1, 'Enter the current use of the building.').max(160),
  proposedUse: z.string().trim().min(1, 'Enter the proposed use of the building.').max(160),
  selectedCertifierPresetId: optionalText(120),
  workStartedBeforeApplication: formBoolean.optional(),
  disabledPersonsFacilitiesOnly: formBoolean.optional(),
  certifierOfDesignCertificateAvailable: formBoolean.optional(),
  certifierOfConstructionCertificateAvailable: formBoolean.optional(),
  schemeType: optionalText(120),
  registrationAPart1: certifierRegistrationPart1Schema,
  registrationAPart2: z.string().trim().min(1, 'Enter Registration number A Part 2.').max(80),
  certifierName: z.string().trim().min(1, 'Enter the name of the certifier.').max(160),
  registrationBPart1: certifierRegistrationPart1Schema,
  registrationBPart2: z.string().trim().min(1, 'Enter Registration number B Part 2.').max(80),
  approvedBody: z.string().trim().min(1, 'Enter the name of the approved body.').max(160),
  applicantIsOwner: formCheckboxBoolean,
  applicationIsStaged: formCheckboxBoolean,
  intendedLifeFiveYearsOrLess: formCheckboxBoolean,
  fireAndRescueServiceEnforcingAuthority: formCheckboxBoolean,
  listedBuildingOrConservationArea: formCheckboxBoolean,
  otherHistoricalImportance: formCheckboxBoolean,
  scottishMinistersRelaxationDirection: formCheckboxBoolean,
  dangerousBuildingNotice: formCheckboxBoolean,
  approvedCertifierOfConstruction: formCheckboxBoolean,
  coveredBySTAS: formCheckboxBoolean,
  restrictPublicInspection: formCheckboxBoolean,
});

export const organisationDefaultsSchema = z.object({
  practiceName: optionalText(160),
  agentFirstName: optionalText(100),
  agentLastName: optionalText(100),
  agentEmail: z.preprocess(
    blankContactToUndefined,
    z.string().trim().max(160).email('Enter a valid agent email address.').transform((value) => value.toLowerCase()).optional(),
  ),
  agentPhone: z.preprocess(
    blankContactToUndefined,
    z.string().trim().max(30).refine(isValidUkPhone, 'Enter a valid agent phone number.').optional(),
  ),
  agentBuildingNumber: optionalText(40),
  agentAddressLine1: optionalText(160),
  agentAddressLine2: optionalText(160),
  agentTownCity: optionalText(100),
  agentPostcode: optionalText(20),
  agentCountry: z.preprocess(emptyToUndefined, z.string().trim().max(100).default('United Kingdom')),
  defaultCertifierPresetId: optionalText(120),
});

export const certifierPresetSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  schemeType: optionalText(120),
  registrationAPart1: z.preprocess(emptyToUndefined, certifierRegistrationPart1Schema.optional()),
  registrationAPart2: optionalText(80),
  registrationBPart1: z.preprocess(emptyToUndefined, certifierRegistrationPart1Schema.optional()),
  registrationBPart2: optionalText(80),
  certifierName: optionalText(160),
  approvedBody: optionalText(160),
  isDefault: z.preprocess((value) => value === true || value === 'true' || value === 'on', z.boolean().default(false)),
});

export const documentMetadataSchema = z.object({
  type: z.nativeEnum(DocumentType).default(DocumentType.OTHER),
  revision: optionalText(40),
  status: z.nativeEnum(DocumentStatus).default(DocumentStatus.DRAFT),
  notes: optionalText(2000),
});

export const documentSortBatchAcceptSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    documentType: z.nativeEnum(DocumentType),
    revision: optionalText(40),
    status: z.nativeEnum(DocumentStatus).default(DocumentStatus.IN_REVIEW),
    notes: optionalText(2000),
  })).min(1, 'At least one sorted document is required.'),
  returnTo: z.enum(['project-files', 'document-folder', 'project-detail']).default('project-files'),
});

export const documentSortBatchStatusSchema = z.object({
  status: z.nativeEnum(DocumentSortBatchStatus).optional(),
});

export const planningApplicationSchema = z.object({
  applicationReference: optionalText(120),
  submissionDate: optionalDate,
  validDate: optionalDate,
  decisionTargetDate: optionalDate,
  decisionDate: optionalDate,
  status: z.nativeEnum(PlanningStatus).default(PlanningStatus.NOT_STARTED),
  portalUrl: safeUrl,
  notes: optionalText(3000),
});

export const buildingWarrantSchema = z.object({
  warrantReference: optionalText(120),
  warrantType: z.nativeEnum(WarrantType).default(WarrantType.INITIAL),
  submissionDate: optionalDate,
  firstResponseTargetDate: optionalDate,
  grantedDate: optionalDate,
  expiryDate: optionalDate,
  completionCertificateStatus: z.nativeEnum(CompletionCertificateStatus).default(CompletionCertificateStatus.NOT_REQUIRED),
  status: z.nativeEnum(WarrantStatus).default(WarrantStatus.NOT_STARTED),
  portalUrl: safeUrl,
  notes: optionalText(3000),
});

const preSubmissionPlanningStatuses = new Set<PlanningStatus>([
  PlanningStatus.NOT_STARTED,
  PlanningStatus.DRAFTING,
]);
const preSubmissionWarrantStatuses = new Set<WarrantStatus>([
  WarrantStatus.NOT_STARTED,
  WarrantStatus.DRAFTING,
]);

export const planningApplicationCreateSchema = planningApplicationSchema.refine(
  (value) => preSubmissionPlanningStatuses.has(value.status),
  { path: ['status'], message: 'Create the application as not started or drafting, then record submission through its lifecycle.' },
);

export const buildingWarrantCreateSchema = buildingWarrantSchema.refine(
  (value) => preSubmissionWarrantStatuses.has(value.status),
  { path: ['status'], message: 'Create the application as not started or drafting, then record submission through its lifecycle.' },
);

export const markApplicationSubmittedSchema = z.object({}).strict();

export const deadlineSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: optionalText(3000),
  dueDate: z.coerce.date(),
  type: z.nativeEnum(DeadlineType),
  status: z.nativeEnum(DeadlineStatus).default(DeadlineStatus.UPCOMING),
  priority: z.nativeEnum(DeadlinePriority).default(DeadlinePriority.MEDIUM),
  projectId: optionalText(80),
  planningApplicationId: optionalText(80),
  buildingWarrantApplicationId: optionalText(80),
  reminderDate: optionalDate,
  completedDate: optionalDate,
});

export const submissionPackageSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  type: z.nativeEnum(SubmissionPackageType),
  status: z.nativeEnum(SubmissionPackageStatus).default(SubmissionPackageStatus.DRAFT),
  documentIds: z.preprocess((value) => {
    if (value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(z.string()).default([])),
});
