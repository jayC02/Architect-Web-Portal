import {
  AutomationJobSourceType,
  AutomationJobStatus,
  AutomationJobType,
  CompletionCertificateStatus,
  DocumentStatus,
  DocumentType,
  PlanningStatus,
  WarrantStatus,
  WarrantType,
} from '@prisma/client';
import { z } from 'zod';
import { optionalText } from '@/lib/validation/common';

const optionalId = optionalText(120);

export const automationJobCreateSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  type: z.nativeEnum(AutomationJobType),
  sourceType: z.nativeEnum(AutomationJobSourceType).optional(),
  planningApplicationId: optionalId,
  buildingWarrantApplicationId: optionalId,
  documentSortBatchId: optionalId,
  documentIds: z.preprocess((value) => {
    if (value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(z.string().trim().min(1).max(120)).default([])),
  notes: optionalText(3000),
});

export const automationJobListQuerySchema = z.object({
  projectId: optionalId,
  type: z.nativeEnum(AutomationJobType).optional(),
  status: z.nativeEnum(AutomationJobStatus).optional(),
});

export const automationJobStatusUpdateSchema = z.object({
  status: z.enum([
    AutomationJobStatus.READY,
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.CANCELLED,
  ]),
});

const dateString = z.string().datetime().nullable();
const nullableText = z.string().nullable();

export const automationJobDocumentSnapshotItemSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  type: z.nativeEnum(DocumentType),
  status: z.nativeEnum(DocumentStatus),
  revision: nullableText,
  drawingNumber: nullableText,
  drawingTitle: nullableText,
  uploadedAt: z.string().datetime(),
});

export const automationJobDocumentSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.array(automationJobDocumentSnapshotItemSchema),
});

export const automationJobSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  jobType: z.nativeEnum(AutomationJobType),
  sourceType: z.nativeEnum(AutomationJobSourceType),
  organisation: z.object({
    id: z.string(),
    name: z.string(),
  }),
  project: z.object({
    id: z.string(),
    name: z.string(),
    internalReference: nullableText,
    projectType: nullableText,
    stage: z.string(),
    status: z.string(),
    localAuthority: nullableText,
    siteAddress: nullableText,
    notes: nullableText,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  client: z.object({
    id: z.string(),
    name: z.string(),
    email: nullableText,
    phone: nullableText,
    address: nullableText,
    notes: nullableText,
  }).nullable(),
  site: z.object({
    id: z.string(),
    addressLine1: z.string(),
    addressLine2: nullableText,
    townCity: z.string(),
    postcode: z.string(),
    localAuthority: nullableText,
    notes: nullableText,
  }).nullable(),
  planningApplication: z.object({
    id: z.string(),
    applicationReference: nullableText,
    submissionDate: dateString,
    validDate: dateString,
    decisionTargetDate: dateString,
    decisionDate: dateString,
    status: z.nativeEnum(PlanningStatus),
    portalUrl: nullableText,
    notes: nullableText,
  }).nullable(),
  buildingWarrantApplication: z.object({
    id: z.string(),
    warrantReference: nullableText,
    warrantType: z.nativeEnum(WarrantType),
    submissionDate: dateString,
    firstResponseTargetDate: dateString,
    grantedDate: dateString,
    expiryDate: dateString,
    completionCertificateStatus: z.nativeEnum(CompletionCertificateStatus),
    status: z.nativeEnum(WarrantStatus),
    portalUrl: nullableText,
    notes: nullableText,
  }).nullable(),
  applicationQuestions: z.record(z.unknown()),
  documents: z.array(automationJobDocumentSnapshotItemSchema),
  notes: nullableText,
  createdAt: z.string().datetime(),
});

const typeOfWorkKeySchema = z.enum([
  'domestic_alteration_extension',
  'new_build',
  'conversion_change_of_use',
  'demolition',
]);

const structuredAddressSchema = z.object({
  addressLine1: nullableText,
  addressLine2: nullableText,
  townCity: nullableText,
  postcode: nullableText,
  country: nullableText,
});

const preflightIssueSchema = z.object({
  code: z.string().min(1),
  field: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']),
});

export const automationJobSnapshotV2Schema = z.object({
  contractVersion: z.literal('architectpro.automation-job'),
  snapshotVersion: z.literal(2),
  metadata: z.object({
    jobId: nullableText,
    organisationId: z.string().min(1),
    projectId: z.string().min(1),
    applicationType: z.nativeEnum(AutomationJobType),
    sourceType: z.nativeEnum(AutomationJobSourceType),
    createdAt: z.string().datetime(),
    createdBy: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      email: z.string().email(),
    }),
    sourceUpdatedAt: z.string().datetime(),
    presetVersion: z.number().int().positive(),
    integrity: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  }),
  organisation: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    practiceName: nullableText,
    agent: z.object({
      firstName: nullableText,
      lastName: nullableText,
      email: nullableText,
      phone: nullableText,
      address: structuredAddressSchema,
      source: z.literal('ORGANISATION_DEFAULTS'),
    }),
  }),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    internalReference: nullableText,
    typeOfWorkKey: typeOfWorkKeySchema,
    typeOfWorkLabel: z.string().min(1),
    notes: nullableText,
    stage: z.string().min(1),
    status: z.string().min(1),
    localAuthority: nullableText,
    updatedAt: z.string().datetime(),
  }),
  site: z.object({
    id: nullableText,
    displayName: nullableText,
    address: structuredAddressSchema,
    localAuthority: nullableText,
    source: z.enum(['SITE', 'LEGACY_PROJECT']),
    updatedAt: z.string().datetime().nullable(),
  }),
  applicant: z.object({
    clientId: nullableText,
    displayName: nullableText,
    title: nullableText,
    firstName: nullableText,
    lastName: nullableText,
    companyName: nullableText,
    email: nullableText,
    phone: nullableText,
    address: structuredAddressSchema,
    applicantIsOwner: z.boolean().nullable(),
    source: z.enum(['CLIENT', 'MISSING']),
    updatedAt: z.string().datetime().nullable(),
  }),
  planning: z.object({
    recordId: nullableText,
    description: nullableText,
    status: z.nativeEnum(PlanningStatus).nullable(),
    applicationReference: nullableText,
    answers: z.object({
      discussedWithPlanningAuthority: z.boolean(),
      treesOnOrAdjacentToSite: z.boolean(),
      newOrAlteredVehicleAccess: z.boolean(),
      currentParkingSpaces: z.number().int().nonnegative().nullable(),
      proposedParkingSpaces: z.number().int().nonnegative().nullable(),
      soleOwner: z.boolean().nullable(),
      agriculturalHolding: z.boolean().nullable(),
    }),
    updatedAt: z.string().datetime().nullable(),
  }).nullable(),
  buildingWarrant: z.object({
    recordId: nullableText,
    presetKey: typeOfWorkKeySchema,
    presetLabel: z.string().min(1),
    presetVersion: z.number().int().positive(),
    description: nullableText,
    estimatedValue: z.number().nonnegative().nullable(),
    currentUse: nullableText,
    proposedUse: nullableText,
    status: z.nativeEnum(WarrantStatus).nullable(),
    warrantReference: nullableText,
    unusualAnswers: z.object({
      applicantIsOwner: z.boolean(),
      applicationIsStaged: z.boolean(),
      intendedLifeFiveYearsOrLess: z.boolean(),
      fireAndRescueServiceEnforcingAuthority: z.boolean(),
      listedBuildingOrConservationArea: z.boolean(),
      otherHistoricalImportance: z.boolean(),
      scottishMinistersRelaxationDirection: z.boolean(),
      dangerousBuildingNotice: z.boolean(),
      approvedCertifierOfConstruction: z.boolean(),
      coveredBySTAS: z.boolean(),
      restrictPublicInspection: z.boolean(),
    }),
    certifier: z.object({
      presetId: z.string().min(1),
      displayName: z.string().min(1),
      schemeType: nullableText,
      registrationAPart1: nullableText,
      registrationAPart2: nullableText,
      registrationBPart1: nullableText,
      registrationBPart2: nullableText,
      certifierName: nullableText,
      approvedBody: nullableText,
    }).nullable(),
    updatedAt: z.string().datetime().nullable(),
  }).nullable(),
  documents: z.array(z.object({
    id: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    categoryKey: z.nativeEnum(DocumentType),
    categoryLabel: z.string().min(1),
    drawingTitle: nullableText,
    drawingNumber: nullableText,
    revision: nullableText,
    classificationSource: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    reviewState: z.nativeEnum(DocumentStatus),
    required: z.boolean(),
    relevance: z.array(z.enum(['PLANNING', 'BUILDING_WARRANT'])),
    downloadRef: z.object({ documentId: z.string().min(1) }),
    updatedAt: z.string().datetime(),
  })),
  preflight: z.object({
    status: z.enum(['READY', 'NEEDS_INPUT', 'BLOCKED']),
    missing: z.array(preflightIssueSchema),
    warnings: z.array(preflightIssueSchema),
    locationPlanStatus: z.enum(['REVIEWED', 'PRESENT_UNREVIEWED', 'MISSING']),
    reviewedAt: z.string().datetime().nullable(),
  }),
});

export type AutomationJobSnapshotV2 = z.infer<typeof automationJobSnapshotV2Schema>;

const forbiddenSnapshotKeys = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'session',
  'sessionId',
  'secret',
  'apiKey',
  'storageKey',
  'storagePath',
]);

export const assertSafeAutomationSnapshot = (value: unknown, path: string[] = []) => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeAutomationSnapshot(item, [...path, String(index)]));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSnapshotKeys.has(key)) {
      throw new Error(`Unsafe automation snapshot field: ${[...path, key].join('.')}`);
    }
    assertSafeAutomationSnapshot(child, [...path, key]);
  }
};
