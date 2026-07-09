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
  status: z.enum([AutomationJobStatus.READY, AutomationJobStatus.CANCELLED]),
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
