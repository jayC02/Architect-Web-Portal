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
import { optionalDate, optionalText, safeUrl } from '@/lib/validation/common';

export const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: optionalText(160).pipe(z.string().email().optional()),
  phone: optionalText(60),
  address: optionalText(500),
  notes: optionalText(2000),
});

export const siteSchema = z.object({
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
  returnTo: z.enum(['project-files', 'document-folder']).default('project-files'),
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
