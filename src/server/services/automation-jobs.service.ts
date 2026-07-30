import { createHash } from 'node:crypto';
import {
  AutomationJobSourceType,
  AutomationJobType,
  DocumentType,
  PlanningStatus,
  WarrantStatus,
  type ProjectDocument,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { typeOfWorkKey, typeOfWorkLabel } from '@/lib/projects/type-of-work';
import {
  assertSafeAutomationSnapshot,
  automationJobSnapshotV2Schema,
} from '@/lib/validation/automation-job';
import {
  buildingWarrantPreparationSchema,
  householderPreparationSchema,
} from '@/lib/validation/domain';
import { HttpError } from '@/lib/utils/http';
import { evaluateAutomationPreflight } from '@/server/services/automation-preflight.service';

type BuildAutomationJobSnapshotInput = {
  jobId?: string;
  organisationId: string;
  organisationName: string;
  projectId: string;
  type: AutomationJobType;
  createdBy: { id: string; name: string; email: string };
  createdAt?: Date;
  sourceType?: AutomationJobSourceType;
  planningApplicationId?: string;
  buildingWarrantApplicationId?: string;
  documentSortBatchId?: string;
  documentIds?: string[];
  notes?: string;
};

const uniqueIds = (ids: string[] | undefined) => Array.from(new Set((ids ?? []).filter(Boolean)));
const asIso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const maxDate = (dates: Array<Date | null | undefined>) =>
  new Date(Math.max(...dates.filter((value): value is Date => Boolean(value)).map((value) => value.getTime())));
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const inferSourceType = (input: BuildAutomationJobSnapshotInput) => {
  if (input.sourceType) return input.sourceType;
  if (input.planningApplicationId) return AutomationJobSourceType.PLANNING_RECORD;
  if (input.buildingWarrantApplicationId) return AutomationJobSourceType.WARRANT_RECORD;
  if (input.documentSortBatchId) return AutomationJobSourceType.DOCUMENT_BATCH;
  return AutomationJobSourceType.PROJECT;
};

const getJobTitle = (type: AutomationJobType, projectName: string) => {
  const prefix = type === AutomationJobType.HOUSEHOLDER_PLANNING
    ? 'Householder planning automation'
    : type === AutomationJobType.PLANNING_APPLICATION
      ? 'Planning automation'
      : 'Building warrant automation';
  return `${prefix} - ${projectName}`;
};

const documentRelevance = (type: DocumentType) => {
  const planning = new Set<DocumentType>([
    DocumentType.LOCATION_PLAN,
    DocumentType.SITE_PLAN,
    DocumentType.BLOCK_PLAN,
    DocumentType.EXISTING_DRAWING,
    DocumentType.PROPOSED_DRAWING,
    DocumentType.ELEVATION,
    DocumentType.SECTION,
    DocumentType.PHOTO,
    DocumentType.SUPPORTING_DOCUMENT,
  ]);
  const warrant = new Set<DocumentType>([
    DocumentType.LOCATION_PLAN,
    DocumentType.SITE_PLAN,
    DocumentType.BLOCK_PLAN,
    DocumentType.EXISTING_DRAWING,
    DocumentType.PROPOSED_DRAWING,
    DocumentType.ELEVATION,
    DocumentType.SECTION,
    DocumentType.DETAILS,
    DocumentType.CALCULATIONS,
    DocumentType.SPECIFICATIONS,
    DocumentType.DRAINAGE,
    DocumentType.STRUCTURAL,
    DocumentType.ENERGY,
    DocumentType.CERTIFICATE,
    DocumentType.SUPPORTING_DOCUMENT,
  ]);
  return [
    ...(planning.has(type) ? ['PLANNING' as const] : []),
    ...(warrant.has(type) ? ['BUILDING_WARRANT' as const] : []),
  ];
};

const mapDocument = (document: ProjectDocument) => ({
  id: document.id,
  originalFilename: document.originalName || document.fileName,
  filename: document.originalName || document.fileName,
  mimeType: document.mimeType,
  sizeBytes: document.sizeBytes,
  categoryKey: document.type,
  categoryLabel: human(document.type),
  drawingTitle: document.drawingTitle,
  drawingNumber: document.drawingNumber,
  revision: document.revision,
  classificationSource: document.sortSource,
  confidence: document.sortConfidence,
  reviewState: document.status,
  required: document.type === DocumentType.LOCATION_PLAN,
  relevance: documentRelevance(document.type),
  downloadRef: { documentId: document.id },
  updatedAt: document.updatedAt.toISOString(),
});

export const buildAutomationJobSnapshot = async (input: BuildAutomationJobSnapshotInput) => {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organisationId: input.organisationId },
    include: { client: true, site: true },
  });
  if (!project) throw new HttpError(404, 'Project not found.');

  const [defaults, requestedPlanning, requestedWarrant, latestPlanning, latestWarrant, sortBatch] = await Promise.all([
    prisma.organisationDefaults.findUnique({
      where: { organisationId: input.organisationId },
      include: { defaultCertifierPreset: true },
    }),
    input.planningApplicationId
      ? prisma.planningApplication.findFirst({
          where: { id: input.planningApplicationId, organisationId: input.organisationId, projectId: project.id },
        })
      : Promise.resolve(null),
    input.buildingWarrantApplicationId
      ? prisma.buildingWarrantApplication.findFirst({
          where: { id: input.buildingWarrantApplicationId, organisationId: input.organisationId, projectId: project.id },
          include: { selectedCertifierPreset: true },
        })
      : Promise.resolve(null),
    !input.planningApplicationId && input.type !== AutomationJobType.BUILDING_WARRANT
      ? prisma.planningApplication.findFirst({
          where: { organisationId: input.organisationId, projectId: project.id },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve(null),
    !input.buildingWarrantApplicationId && input.type === AutomationJobType.BUILDING_WARRANT
      ? prisma.buildingWarrantApplication.findFirst({
          where: { organisationId: input.organisationId, projectId: project.id },
          include: { selectedCertifierPreset: true },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve(null),
    input.documentSortBatchId
      ? prisma.documentSortBatch.findFirst({
          where: { id: input.documentSortBatchId, organisationId: input.organisationId, projectId: project.id },
          include: { items: true },
        })
      : Promise.resolve(null),
  ]);

  if (input.planningApplicationId && !requestedPlanning) throw new HttpError(404, 'Planning application not found.');
  if (input.buildingWarrantApplicationId && !requestedWarrant) throw new HttpError(404, 'Building warrant application not found.');
  if (input.documentSortBatchId && !sortBatch) throw new HttpError(404, 'Document sort batch not found.');

  const planning = requestedPlanning ?? latestPlanning;
  const warrant = requestedWarrant ?? latestWarrant;
  const batchIds = sortBatch?.items.map((item) => item.documentId).filter((id): id is string => Boolean(id)) ?? [];
  const selectedIds = uniqueIds(input.documentIds).length ? uniqueIds(input.documentIds) : uniqueIds(batchIds);
  const documents = await prisma.projectDocument.findMany({
    where: {
      organisationId: input.organisationId,
      projectId: project.id,
      ...(selectedIds.length ? { id: { in: selectedIds } } : {}),
    },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  if (selectedIds.length && documents.length !== selectedIds.length) {
    throw new HttpError(400, 'One or more documents do not belong to this project.');
  }

  const warrantAnswers = buildingWarrantPreparationSchema.parse(jsonObject(warrant?.preparationData));
  const planningAnswers = householderPreparationSchema.parse(jsonObject(planning?.preparationData));
  const presetKey = typeOfWorkKey(warrant?.presetKey ?? project.projectType);
  const presetLabel = typeOfWorkLabel(presetKey);
  const selectedCertifier = warrant?.selectedCertifierPreset ?? defaults?.defaultCertifierPreset ?? null;
  const sourceType = inferSourceType(input);
  const sourceUpdatedAt = maxDate([
    project.updatedAt,
    project.client?.updatedAt,
    project.site?.updatedAt,
    planning?.updatedAt,
    warrant?.updatedAt,
    defaults?.updatedAt,
    selectedCertifier?.updatedAt,
    ...documents.map((document) => document.updatedAt),
  ]);

  const site = project.site
    ? {
        id: project.site.id,
        displayName: project.site.addressLine1,
        address: {
          addressLine1: project.site.addressLine1,
          addressLine2: project.site.addressLine2,
          townCity: project.site.townCity,
          postcode: project.site.postcode,
          country: 'United Kingdom',
        },
        localAuthority: project.site.localAuthority,
        source: 'SITE' as const,
        updatedAt: project.site.updatedAt.toISOString(),
      }
    : {
        id: null,
        displayName: project.siteAddress,
        address: {
          addressLine1: project.siteAddress,
          addressLine2: null,
          townCity: null,
          postcode: null,
          country: 'United Kingdom',
        },
        localAuthority: project.localAuthority,
        source: 'LEGACY_PROJECT' as const,
        updatedAt: null,
      };

  const applicantOwner = input.type === AutomationJobType.BUILDING_WARRANT
    ? warrantAnswers.applicantIsOwner
    : planningAnswers.soleOwner ?? null;
  const applicant = project.client
    ? {
        clientId: project.client.id,
        clientType: project.client.companyName ? 'ORGANISATION' as const : 'INDIVIDUAL' as const,
        displayName: project.client.name,
        title: project.client.title,
        firstName: project.client.firstName,
        lastName: project.client.lastName,
        companyName: project.client.companyName,
        email: project.client.email,
        phone: project.client.phone,
        address: {
          addressLine1: project.client.addressLine1 ?? project.client.address,
          addressLine2: project.client.addressLine2,
          townCity: project.client.townCity,
          postcode: project.client.postcode,
          country: project.client.country ?? 'United Kingdom',
        },
        applicantIsOwner: applicantOwner,
        source: 'CLIENT' as const,
        updatedAt: project.client.updatedAt.toISOString(),
      }
    : {
        clientId: null,
        clientType: null,
        displayName: null,
        title: null,
        firstName: null,
        lastName: null,
        companyName: null,
        email: null,
        phone: null,
        address: { addressLine1: null, addressLine2: null, townCity: null, postcode: null, country: null },
        applicantIsOwner: applicantOwner,
        source: 'MISSING' as const,
        updatedAt: null,
      };

  const baseSnapshot = {
    contractVersion: 'architectpro.automation-job' as const,
    snapshotVersion: 2 as const,
    metadata: {
      jobId: input.jobId ?? null,
      organisationId: input.organisationId,
      projectId: project.id,
      applicationType: input.type,
      sourceType,
      createdAt: (input.createdAt ?? new Date()).toISOString(),
      createdBy: input.createdBy,
      sourceUpdatedAt: sourceUpdatedAt.toISOString(),
      presetVersion: warrant?.presetVersion ?? 1,
      integrity: null,
    },
    organisation: {
      id: input.organisationId,
      name: input.organisationName,
      practiceName: defaults?.practiceName ?? input.organisationName,
      agent: {
        firstName: defaults?.agentFirstName ?? null,
        lastName: defaults?.agentLastName ?? null,
        email: defaults?.agentEmail ?? null,
        phone: defaults?.agentPhone ?? null,
        address: {
          addressLine1: defaults?.agentAddressLine1 ?? null,
          addressLine2: defaults?.agentAddressLine2 ?? null,
          townCity: defaults?.agentTownCity ?? null,
          postcode: defaults?.agentPostcode ?? null,
          country: defaults?.agentCountry ?? 'United Kingdom',
        },
        source: 'ORGANISATION_DEFAULTS' as const,
      },
    },
    project: {
      id: project.id,
      name: project.name,
      internalReference: project.internalReference,
      typeOfWorkKey: typeOfWorkKey(project.projectType),
      typeOfWorkLabel: typeOfWorkLabel(project.projectType),
      notes: project.notes,
      stage: project.stage,
      status: project.status,
      localAuthority: site.localAuthority,
      updatedAt: project.updatedAt.toISOString(),
    },
    site,
    applicant,
    planning: input.type === AutomationJobType.BUILDING_WARRANT ? null : {
      recordId: planning?.id ?? null,
      description: planning?.description ?? planning?.notes ?? null,
      status: planning?.status ?? null,
      applicationReference: planning?.applicationReference ?? null,
      answers: {
        discussedWithPlanningAuthority: planningAnswers.discussedWithPlanningAuthority,
        treesOnOrAdjacentToSite: planningAnswers.treesOnOrAdjacentToSite,
        newOrAlteredVehicleAccess: planningAnswers.newOrAlteredVehicleAccess,
        currentParkingSpaces: planningAnswers.currentParkingSpaces ?? null,
        proposedParkingSpaces: planningAnswers.proposedParkingSpaces ?? null,
        soleOwner: planningAnswers.soleOwner ?? null,
        agriculturalHolding: planningAnswers.agriculturalHolding ?? null,
      },
      updatedAt: asIso(planning?.updatedAt),
    },
    buildingWarrant: input.type !== AutomationJobType.BUILDING_WARRANT ? null : {
      recordId: warrant?.id ?? null,
      presetKey,
      presetLabel,
      presetVersion: warrant?.presetVersion ?? 1,
      description: warrant?.description ?? warrant?.notes ?? null,
      estimatedValue: warrant?.estimatedValue ? Number(warrant.estimatedValue) : null,
      currentUse: warrant?.currentUse ?? null,
      proposedUse: warrant?.proposedUse ?? null,
      status: warrant?.status ?? null,
      warrantReference: warrant?.warrantReference ?? null,
      unusualAnswers: warrantAnswers,
      certifier: selectedCertifier ? {
        presetId: selectedCertifier.id,
        displayName: selectedCertifier.displayName,
        schemeType: selectedCertifier.schemeType,
        registrationAPart1: selectedCertifier.registrationAPart1,
        registrationAPart2: selectedCertifier.registrationAPart2,
        registrationBPart1: selectedCertifier.registrationBPart1,
        registrationBPart2: selectedCertifier.registrationBPart2,
        certifierName: selectedCertifier.certifierName,
        approvedBody: selectedCertifier.approvedBody,
      } : null,
      updatedAt: asIso(warrant?.updatedAt),
    },
    documents: documents.map(mapDocument),
  };

  const preflight = evaluateAutomationPreflight(baseSnapshot);
  const withoutIntegrity = { ...baseSnapshot, preflight };
  const integrity = `sha256:${createHash('sha256').update(canonicalJson(withoutIntegrity)).digest('hex')}`;
  const dataSnapshot = automationJobSnapshotV2Schema.parse({
    ...withoutIntegrity,
    metadata: { ...baseSnapshot.metadata, integrity },
  });

  assertSafeAutomationSnapshot(dataSnapshot);
  return {
    title: getJobTitle(input.type, project.name),
    sourceType,
    dataSnapshot,
    documentSnapshot: {
      schemaVersion: 2,
      documents: dataSnapshot.documents,
    },
    snapshotHash: integrity,
    sourceUpdatedAt,
    preflight,
  };
};

export const ensureAutomationApplicationRecord = async (
  organisationId: string,
  projectId: string,
  type: AutomationJobType,
) => {
  if (type === AutomationJobType.BUILDING_WARRANT) {
    const existing = await prisma.buildingWarrantApplication.findFirst({
      where: { organisationId, projectId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await prisma.buildingWarrantApplication.updateMany({
        where: { id: existing.id, organisationId, projectId, status: WarrantStatus.NOT_STARTED },
        data: { status: WarrantStatus.DRAFTING, preparedAt: new Date() },
      });
      return { buildingWarrantApplicationId: existing.id };
    }
    const project = await prisma.project.findFirst({
      where: { id: projectId, organisationId },
      select: { projectType: true },
    });
    if (!project) throw new HttpError(404, 'Project not found.');
    const created = await prisma.buildingWarrantApplication.create({
      data: {
        organisationId,
        projectId,
        presetKey: typeOfWorkKey(project.projectType),
        status: WarrantStatus.DRAFTING,
        preparedAt: new Date(),
      },
      select: { id: true },
    });
    return { buildingWarrantApplicationId: created.id };
  }

  const existing = await prisma.planningApplication.findFirst({
    where: { organisationId, projectId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (existing) {
    await prisma.planningApplication.updateMany({
      where: { id: existing.id, organisationId, projectId, status: PlanningStatus.NOT_STARTED },
      data: { status: PlanningStatus.DRAFTING, preparedAt: new Date() },
    });
    return { planningApplicationId: existing.id };
  }
  const created = await prisma.planningApplication.create({
    data: {
      organisationId,
      projectId,
      status: PlanningStatus.DRAFTING,
      preparedAt: new Date(),
    },
    select: { id: true },
  });
  return { planningApplicationId: created.id };
};

export const currentAutomationSourceUpdatedAt = async (
  organisationId: string,
  projectId: string,
  snapshot: unknown,
) => {
  const parsed = automationJobSnapshotV2Schema.safeParse(snapshot);
  if (!parsed.success) return null;
  const data = parsed.data;
  const documentIds = data.documents.map((document) => document.id);
  const [project, planning, warrant, defaults, certifier, documents] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, organisationId },
      include: { client: { select: { updatedAt: true } }, site: { select: { updatedAt: true } } },
    }),
    data.planning?.recordId
      ? prisma.planningApplication.findFirst({
          where: { id: data.planning.recordId, organisationId, projectId },
          select: { updatedAt: true },
        })
      : Promise.resolve(null),
    data.buildingWarrant?.recordId
      ? prisma.buildingWarrantApplication.findFirst({
          where: { id: data.buildingWarrant.recordId, organisationId, projectId },
          select: { updatedAt: true },
        })
      : Promise.resolve(null),
    prisma.organisationDefaults.findUnique({
      where: { organisationId },
      select: { updatedAt: true },
    }),
    data.buildingWarrant?.certifier?.presetId
      ? prisma.organisationCertifierPreset.findFirst({
          where: { id: data.buildingWarrant.certifier.presetId, organisationId },
          select: { updatedAt: true },
        })
      : Promise.resolve(null),
    documentIds.length
      ? prisma.projectDocument.findMany({
          where: { id: { in: documentIds }, organisationId, projectId },
          select: { updatedAt: true },
        })
      : Promise.resolve([]),
  ]);
  if (!project) return null;
  return maxDate([
    project.updatedAt,
    project.client?.updatedAt,
    project.site?.updatedAt,
    planning?.updatedAt,
    warrant?.updatedAt,
    defaults?.updatedAt,
    certifier?.updatedAt,
    ...documents.map((document) => document.updatedAt),
  ]);
};
