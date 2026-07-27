import { createHash } from 'node:crypto';
import { AutomationJobType, DocumentStatus, DocumentType, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import {
  applicationPreparationDraftSchema,
  documentFactSchema,
  type ApplicationPreparationDraft,
} from '@/lib/validation/document-intelligence';
import { HttpError } from '@/lib/utils/http';

type Fact = {
  documentId: string;
  filename: string;
  fieldKey: string;
  value: string | number | boolean;
  page?: number;
  evidence: string;
  certainty: 'high' | 'medium' | 'low';
};

const isPresent = (value: unknown) =>
  value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

const normaliseComparable = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : value;

const factsFromAnalysis = (
  document: { id: string; originalName: string; fileName: string; analysisResult: unknown },
): Fact[] => {
  if (!document.analysisResult || typeof document.analysisResult !== 'object' || Array.isArray(document.analysisResult)) return [];
  const classification = (document.analysisResult as { classification?: unknown }).classification;
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) return [];
  const rawFacts = (classification as { extractedFacts?: unknown }).extractedFacts;
  if (!Array.isArray(rawFacts)) return [];
  return rawFacts.flatMap((raw) => {
    const parsed = documentFactSchema.safeParse(raw);
    return parsed.success ? [{
      documentId: document.id,
      filename: document.originalName || document.fileName,
      ...parsed.data,
    }] : [];
  });
};

const sourceFor = (fact: Fact) => ({
  documentId: fact.documentId,
  filename: fact.filename,
  ...(fact.page ? { page: fact.page } : {}),
  evidence: fact.evidence,
});

export const synthesiseFieldSuggestion = (
  fieldKey: string,
  currentValue: unknown,
  facts: Fact[],
): { suggestion: ApplicationPreparationDraft['fields'][string]; conflict?: ApplicationPreparationDraft['conflicts'][number] } => {
  const candidates = facts
    .filter((fact) => fact.fieldKey === fieldKey)
    .sort((left, right) => ({ high: 3, medium: 2, low: 1 }[right.certainty] - ({ high: 3, medium: 2, low: 1 }[left.certainty])));
  const best = candidates[0];
  if (isPresent(currentValue)) {
    const conflictFact = candidates.find((fact) =>
      fact.certainty !== 'low' && normaliseComparable(fact.value) !== normaliseComparable(currentValue));
    if (conflictFact) {
      return {
        suggestion: {
          value: currentValue as string | number | boolean,
          currentValue: currentValue as string | number | boolean,
          status: 'conflict',
          certainty: conflictFact.certainty,
          sources: [sourceFor(conflictFact)],
        },
        conflict: {
          fieldKey: conflictFact.fieldKey as ApplicationPreparationDraft['conflicts'][number]['fieldKey'],
          currentValue: currentValue as string | number | boolean,
          suggestedValue: conflictFact.value,
          sources: [sourceFor(conflictFact)],
        },
      };
    }
    return {
      suggestion: {
        value: currentValue as string | number | boolean,
        status: 'existing',
        certainty: 'high',
        sources: [],
      },
    };
  }
  if (best) {
    return {
      suggestion: {
        value: best.value,
        status: best.certainty === 'low' ? 'missing' : 'suggested',
        certainty: best.certainty,
        sources: [sourceFor(best)],
      },
    };
  }
  return { suggestion: { value: null, status: 'missing', certainty: 'low', sources: [] } };
};

const hashDraft = (draft: ApplicationPreparationDraft) =>
  `sha256:${createHash('sha256').update(JSON.stringify(draft)).digest('hex')}`;

export const buildApplicationPreparationDraft = async (
  jobId: string,
  organisationId: string,
): Promise<ApplicationPreparationDraft> => {
  const job = await prisma.automationJob.findFirst({
    where: { id: jobId, organisationId },
    include: {
      project: { include: { client: true, site: true } },
      organisation: { include: { defaults: true } },
    },
  });
  if (!job) throw new HttpError(404, 'Prepared application not found.');
  const snapshot = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
  if (!snapshot.success) throw new HttpError(409, 'This legacy job cannot use application preparation.');
  const documents = await prisma.projectDocument.findMany({
    where: { organisationId, projectId: job.projectId },
    orderBy: { createdAt: 'desc' },
  });
  const facts = documents.flatMap(factsFromAnalysis);
  const data = snapshot.data;
  const current: Record<string, unknown> = {
    'project.title': job.project.name,
    'project.typeOfWork': job.project.projectType,
    'site.addressLine1': job.project.site?.addressLine1 ?? job.project.siteAddress,
    'site.addressLine2': job.project.site?.addressLine2,
    'site.townCity': job.project.site?.townCity,
    'site.postcode': job.project.site?.postcode,
    'site.localAuthority': job.project.site?.localAuthority ?? job.project.localAuthority,
    'applicant.clientType': job.project.client?.companyName ? 'company' : 'individual',
    'applicant.title': job.project.client?.title,
    'applicant.firstName': job.project.client?.firstName,
    'applicant.lastName': job.project.client?.lastName,
    'applicant.companyName': job.project.client?.companyName,
    'applicant.email': job.project.client?.email,
    'applicant.phone': job.project.client?.phone,
    'applicant.addressLine1': job.project.client?.addressLine1 ?? job.project.client?.address,
    'applicant.addressLine2': job.project.client?.addressLine2,
    'applicant.townCity': job.project.client?.townCity,
    'applicant.postcode': job.project.client?.postcode,
    'applicant.country': job.project.client?.country,
    'agent.practiceName': job.organisation.defaults?.practiceName,
    'agent.firstName': job.organisation.defaults?.agentFirstName,
    'agent.lastName': job.organisation.defaults?.agentLastName,
    'agent.email': job.organisation.defaults?.agentEmail,
    'agent.phone': job.organisation.defaults?.agentPhone,
    'agent.addressLine1': job.organisation.defaults?.agentAddressLine1,
    'agent.addressLine2': job.organisation.defaults?.agentAddressLine2,
    'agent.townCity': job.organisation.defaults?.agentTownCity,
    'agent.postcode': job.organisation.defaults?.agentPostcode,
    'agent.country': job.organisation.defaults?.agentCountry,
    'application.descriptionOfWork': data.buildingWarrant?.description ?? data.planning?.description,
    'application.currentUse': data.buildingWarrant?.currentUse,
    'application.proposedUse': data.buildingWarrant?.proposedUse,
    'application.estimatedValue': data.buildingWarrant?.estimatedValue,
    'application.planningReference': data.planning?.applicationReference,
  };

  const fields: ApplicationPreparationDraft['fields'] = {};
  const conflicts: ApplicationPreparationDraft['conflicts'] = [];
  for (const [fieldKey, currentValue] of Object.entries(current)) {
    const result = synthesiseFieldSuggestion(fieldKey, currentValue, facts);
    fields[fieldKey] = result.suggestion;
    if (result.conflict) conflicts.push(result.conflict);
  }

  const legalEvidence = new Set(facts.filter((fact) => fact.fieldKey.startsWith('evidence.')).map((fact) => fact.fieldKey));
  const unresolvedQuestions: ApplicationPreparationDraft['unresolvedQuestions'] = [];
  if (job.type === AutomationJobType.BUILDING_WARRANT) {
    unresolvedQuestions.push({
      fieldKey: 'buildingWarrant.applicantIsOwner',
      label: 'Is the applicant the owner of the property?',
      reason: 'Ownership is a legal declaration and must be confirmed by a person.',
      blocking: true,
      answerType: 'boolean',
    });
    if (legalEvidence.has('evidence.listedOrConservation')) {
      unresolvedQuestions.push({
        fieldKey: 'buildingWarrant.listedBuildingOrConservationArea',
        label: 'Is the building listed or within a conservation area?',
        reason: 'A document mentions a possible designation. Confirm the official status.',
        blocking: true,
        answerType: 'boolean',
      });
    }
    if (legalEvidence.has('evidence.certifier')) {
      unresolvedQuestions.push({
        fieldKey: 'buildingWarrant.approvedCertifier',
        label: 'Has an approved certifier been formally appointed?',
        reason: 'A certificate reference was found, but formal appointment cannot be inferred.',
        blocking: false,
        answerType: 'boolean',
      });
    }
  } else {
    if (data.planning?.answers.soleOwner === null) unresolvedQuestions.push({
      fieldKey: 'planning.soleOwner',
      label: 'Is the applicant the sole owner of all the land?',
      reason: 'Ownership must be explicitly confirmed.',
      blocking: true,
      answerType: 'boolean',
    });
    if (data.planning?.answers.agriculturalHolding === null) unresolvedQuestions.push({
      fieldKey: 'planning.agriculturalHolding',
      label: 'Is any of the land part of an agricultural holding?',
      reason: 'This ownership declaration must be explicitly confirmed.',
      blocking: true,
      answerType: 'boolean',
    });
  }

  const locationPlans = documents.filter((document) => document.type === DocumentType.LOCATION_PLAN);
  const unresolvedClassifications = documents
    .filter((document) =>
      document.status === DocumentStatus.IN_REVIEW
      || Boolean(document.analysisStatus && document.analysisStatus !== 'SUCCESS'))
    .map((document) => document.id);
  if (locationPlans.length > 1) {
    unresolvedClassifications.push(...locationPlans.map((document) => document.id));
  }
  return applicationPreparationDraftSchema.parse({
    version: 1,
    generatedAt: new Date().toISOString(),
    analysedDocumentCount: documents.filter((document) => document.analysisResult).length,
    failedDocumentCount: documents.filter((document) =>
      Boolean(document.analysisStatus && document.analysisStatus !== 'SUCCESS')).length,
    fields,
    conflicts,
    unresolvedQuestions,
    documentSummary: {
      ...(locationPlans.length === 1 ? { locationPlanDocumentId: locationPlans[0].id } : {}),
      unresolvedClassifications,
      conflicts: locationPlans.length > 1 ? ['More than one document is classified as the Location Plan.'] : [],
      missingLikelyDocumentTypes: locationPlans.length ? [] : ['Location Plan'],
    },
  });
};

export const persistApplicationPreparationDraft = async (jobId: string, organisationId: string) => {
  const draft = await buildApplicationPreparationDraft(jobId, organisationId);
  await prisma.automationJob.updateMany({
    where: { id: jobId, organisationId },
    data: {
      preparationDraft: draft as Prisma.InputJsonValue,
      preparationDraftHash: hashDraft(draft),
      preparationDraftAt: new Date(),
    },
  });
  return draft;
};
