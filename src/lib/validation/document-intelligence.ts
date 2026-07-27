import { z } from 'zod';

export const DOCUMENT_INTELLIGENCE_CATEGORY_KEYS = [
  'location_plan',
  'site_block_plan',
  'existing_plans',
  'proposed_plans',
  'elevations',
  'sections',
  'drainage',
  'construction_details',
  'specifications',
  'calculations',
  'photographs',
  'supporting_documents',
  'other',
  'unsure',
] as const;

export const intelligenceCertaintySchema = z.enum(['high', 'medium', 'low']);

export const documentFactFieldKeys = [
  'project.title',
  'project.typeOfWork',
  'site.addressLine1',
  'site.addressLine2',
  'site.townCity',
  'site.postcode',
  'site.localAuthority',
  'applicant.clientType',
  'applicant.title',
  'applicant.firstName',
  'applicant.lastName',
  'applicant.companyName',
  'applicant.email',
  'applicant.phone',
  'applicant.addressLine1',
  'applicant.addressLine2',
  'applicant.townCity',
  'applicant.postcode',
  'applicant.country',
  'agent.practiceName',
  'agent.firstName',
  'agent.lastName',
  'agent.email',
  'agent.phone',
  'agent.addressLine1',
  'agent.addressLine2',
  'agent.townCity',
  'agent.postcode',
  'agent.country',
  'application.descriptionOfWork',
  'application.currentUse',
  'application.proposedUse',
  'application.buildingType',
  'application.numberOfStoreys',
  'application.estimatedValue',
  'application.planningReference',
  'evidence.listedOrConservation',
  'evidence.ownership',
  'evidence.certifier',
] as const;

export const documentFactSchema = z.object({
  fieldKey: z.enum(documentFactFieldKeys),
  value: z.union([z.string().max(2000), z.number(), z.boolean()]),
  page: z.number().int().positive().optional(),
  evidence: z.string().trim().min(1).max(500),
  certainty: intelligenceCertaintySchema,
}).strict();

export const documentIntelligenceResultSchema = z.object({
  documentId: z.string().optional(),
  classification: z.object({
    categoryKey: z.enum(DOCUMENT_INTELLIGENCE_CATEGORY_KEYS),
    categoryLabel: z.string().trim().min(1).max(120),
    certainty: intelligenceCertaintySchema,
    manualReviewRequired: z.boolean(),
  }).strict(),
  metadata: z.object({
    detectedTitle: z.string().trim().max(240).optional(),
    drawingNumber: z.string().trim().max(120).optional(),
    revision: z.string().trim().max(40).optional(),
    pageCount: z.number().int().positive().optional(),
    existingOrProposed: z.enum(['existing', 'proposed', 'mixed', 'unknown']).default('unknown'),
  }).strict(),
  extractedFacts: z.array(documentFactSchema).max(60),
  warnings: z.array(z.string().trim().max(300)).max(10),
  mixedDocumentDetected: z.boolean(),
}).strict();

export type DocumentIntelligenceResult = z.infer<typeof documentIntelligenceResultSchema>;

export const fieldSuggestionSourceSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  page: z.number().int().positive().optional(),
  evidence: z.string().max(500),
}).strict();

export const fieldSuggestionSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  status: z.enum(['existing', 'suggested', 'confirmed', 'conflict', 'missing']),
  certainty: intelligenceCertaintySchema,
  sources: z.array(fieldSuggestionSourceSchema),
  currentValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
}).strict();

export const applicationPreparationDraftSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  analysedDocumentCount: z.number().int().nonnegative(),
  failedDocumentCount: z.number().int().nonnegative(),
  fields: z.record(z.string(), fieldSuggestionSchema),
  conflicts: z.array(z.object({
    fieldKey: z.enum(documentFactFieldKeys),
    currentValue: z.union([z.string(), z.number(), z.boolean()]),
    suggestedValue: z.union([z.string(), z.number(), z.boolean()]),
    sources: z.array(fieldSuggestionSourceSchema),
  }).strict()),
  unresolvedQuestions: z.array(z.object({
    fieldKey: z.string(),
    label: z.string(),
    reason: z.string(),
    blocking: z.boolean(),
    answerType: z.enum(['boolean', 'text', 'number', 'select']),
  }).strict()),
  documentSummary: z.object({
    locationPlanDocumentId: z.string().optional(),
    unresolvedClassifications: z.array(z.string()),
    conflicts: z.array(z.string()),
    missingLikelyDocumentTypes: z.array(z.string()),
  }).strict(),
}).strict();

export type ApplicationPreparationDraft = z.infer<typeof applicationPreparationDraftSchema>;
