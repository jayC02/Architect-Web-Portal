import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { z } from 'zod';
import { TYPE_OF_WORK_KEYS, type TypeOfWorkKey } from '@/lib/projects/type-of-work';

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().trim().max(maximum).optional(),
  );

const nullableText = (maximum: number) =>
  z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? null : value,
    z.string().trim().max(maximum).nullable(),
  );

export const selectableApplicationDraftTypes = [
  ApplicationDraftType.HOUSEHOLDER_PLANNING,
  ApplicationDraftType.PLANNING_APPLICATION,
  ApplicationDraftType.BUILDING_WARRANT,
] as const;

export const applicationDraftCreateSchema = z.object({
  notes: optionalText(4000),
  applicationType: z.nativeEnum(ApplicationDraftType).default(ApplicationDraftType.AUTO),
}).strict();

export const draftEvidenceSourceSchema = z.object({
  documentId: z.string().min(1).max(120),
  filename: z.string().trim().min(1).max(260),
  page: z.number().int().positive().optional(),
  evidence: z.string().trim().min(1).max(500),
}).strict();

export const draftSuggestedValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  status: z.enum(['existing', 'suggested', 'confirmed', 'conflict', 'default', 'missing']),
  certainty: z.enum(['high', 'medium', 'low']),
  sources: z.array(draftEvidenceSourceSchema).max(25),
  currentValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
}).strict();

const draftSectionSchema = z.record(z.string(), draftSuggestedValueSchema);

export const draftMatchCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  strength: z.enum(['strong', 'possible']),
  label: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(500).optional(),
  reasons: z.array(z.string().trim().max(200)).max(8),
}).strict();

export const preparedApplicationDraftSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  project: draftSectionSchema,
  site: draftSectionSchema,
  client: draftSectionSchema,
  agent: draftSectionSchema,
  application: draftSectionSchema,
  matches: z.object({
    clients: z.array(draftMatchCandidateSchema).max(20),
    sites: z.array(draftMatchCandidateSchema).max(20),
    projects: z.array(draftMatchCandidateSchema).max(20),
  }).strict(),
  summary: z.object({
    documentCount: z.number().int().nonnegative(),
    analysedCount: z.number().int().nonnegative(),
    fallbackCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    preparedFieldCount: z.number().int().nonnegative(),
    attentionCount: z.number().int().nonnegative(),
  }).strict(),
  warnings: z.array(z.string().trim().max(300)).max(30),
}).strict();

export const draftPersonSchema = z.object({
  clientType: z.enum(['INDIVIDUAL', 'ORGANISATION']).default('INDIVIDUAL'),
  displayName: nullableText(160),
  title: nullableText(40),
  firstName: nullableText(100),
  lastName: nullableText(100),
  companyName: nullableText(160),
  email: z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? null : value,
    z.string().trim().email('Enter a valid email address.').max(160).nullable(),
  ),
  phone: nullableText(40),
  addressLine1: nullableText(160),
  addressLine2: nullableText(160),
  townCity: nullableText(100),
  postcode: nullableText(20),
  country: nullableText(100),
}).strict();

export const draftAgentSchema = z.object({
  practiceName: nullableText(160),
  firstName: nullableText(100),
  lastName: nullableText(100),
  email: z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? null : value,
    z.string().trim().email('Enter a valid agent email address.').max(160).nullable(),
  ),
  phone: nullableText(40),
  addressLine1: nullableText(160),
  addressLine2: nullableText(160),
  townCity: nullableText(100),
  postcode: nullableText(20),
  country: nullableText(100),
  saveAsOrganisationDefault: z.boolean().default(false),
}).strict();

export const draftDocumentReviewSchema = z.object({
  id: z.string().min(1).max(120),
  documentType: z.nativeEnum(DocumentType),
  documentStatus: z.nativeEnum(DocumentStatus).default(DocumentStatus.APPROVED),
  revision: nullableText(40),
  drawingNumber: nullableText(120),
  drawingTitle: nullableText(240),
}).strict();

export const applicationDraftReviewSchema = z.object({
  selectedApplicationType: z.nativeEnum(ApplicationDraftType),
  projectMode: z.enum(['create', 'existing']).default('create'),
  existingProjectId: nullableText(120),
  project: z.object({
    name: nullableText(160),
    internalReference: nullableText(80),
    typeOfWorkKey: z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]]).nullable(),
    summary: nullableText(4000),
  }).strict(),
  siteMode: z.enum(['create', 'existing']).default('create'),
  existingSiteId: nullableText(120),
  site: z.object({
    addressLine1: nullableText(160),
    addressLine2: nullableText(160),
    townCity: nullableText(100),
    postcode: nullableText(20),
    country: nullableText(100),
    localAuthority: nullableText(120),
  }).strict(),
  clientMode: z.enum(['create', 'existing']).default('create'),
  existingClientId: nullableText(120),
  client: draftPersonSchema,
  applicantDifferentFromClient: z.boolean().default(false),
  applicant: draftPersonSchema.optional(),
  agent: draftAgentSchema,
  application: z.object({
    description: nullableText(4000),
    currentUse: nullableText(160),
    proposedUse: nullableText(160),
    estimatedValue: z.preprocess(
      (value) => value === '' || value === null || value === undefined ? null : value,
      z.coerce.number().nonnegative().max(9_999_999_999.99).nullable(),
    ),
    presetKey: z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]]).nullable(),
    selectedCertifierPresetId: nullableText(120),
  }).strict(),
  confirmations: z.record(
    z.string().max(120),
    z.union([z.boolean(), z.string().max(500), z.number(), z.null()]),
  ),
  documents: z.array(draftDocumentReviewSchema).max(50),
}).strict();

export type PreparedApplicationDraft = z.infer<typeof preparedApplicationDraftSchema>;
export type ApplicationDraftReview = z.infer<typeof applicationDraftReviewSchema>;

export const applicationDraftUpdateSchema = z.object({
  review: applicationDraftReviewSchema,
}).strict();

export const applicationDraftCommitSchema = z.object({
  review: applicationDraftReviewSchema,
  openDesktop: z.boolean().default(false),
}).strict();
