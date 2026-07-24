import { AutomationJobSourceType, AutomationJobType, type ProjectDocument } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { buildingWarrantProfileForTypeOfWork } from '@/lib/projects/type-of-work';
import {
  assertSafeAutomationSnapshot,
  automationJobDocumentSnapshotSchema,
  automationJobSnapshotSchema,
} from '@/lib/validation/automation-job';
import { HttpError } from '@/lib/utils/http';

type BuildAutomationJobSnapshotInput = {
  organisationId: string;
  organisationName: string;
  projectId: string;
  type: AutomationJobType;
  sourceType?: AutomationJobSourceType;
  planningApplicationId?: string;
  buildingWarrantApplicationId?: string;
  documentSortBatchId?: string;
  documentIds?: string[];
  notes?: string;
};

const toIso = (date: Date | null | undefined) => date ? date.toISOString() : null;
const uniqueIds = (ids: string[] | undefined) => Array.from(new Set((ids ?? []).filter(Boolean)));

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

const mapDocument = (document: Pick<ProjectDocument, 'id' | 'originalName' | 'fileName' | 'mimeType' | 'sizeBytes' | 'type' | 'status' | 'revision' | 'drawingNumber' | 'drawingTitle' | 'createdAt'>) => ({
  id: document.id,
  originalName: document.originalName,
  fileName: document.fileName,
  mimeType: document.mimeType,
  sizeBytes: document.sizeBytes,
  type: document.type,
  status: document.status,
  revision: document.revision,
  drawingNumber: document.drawingNumber,
  drawingTitle: document.drawingTitle,
  uploadedAt: document.createdAt.toISOString(),
});

export const buildAutomationJobSnapshot = async (input: BuildAutomationJobSnapshotInput) => {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organisationId: input.organisationId },
    include: { client: true, site: true },
  });
  if (!project) throw new HttpError(404, 'Project not found.');

  const [planningApplication, buildingWarrantApplication, sortBatch] = await Promise.all([
    input.planningApplicationId
      ? prisma.planningApplication.findFirst({ where: { id: input.planningApplicationId, organisationId: input.organisationId, projectId: project.id } })
      : Promise.resolve(null),
    input.buildingWarrantApplicationId
      ? prisma.buildingWarrantApplication.findFirst({ where: { id: input.buildingWarrantApplicationId, organisationId: input.organisationId, projectId: project.id } })
      : Promise.resolve(null),
    input.documentSortBatchId
      ? prisma.documentSortBatch.findFirst({
          where: { id: input.documentSortBatchId, organisationId: input.organisationId, projectId: project.id },
          include: { items: { include: { document: true } } },
        })
      : Promise.resolve(null),
  ]);

  if (input.planningApplicationId && !planningApplication) throw new HttpError(404, 'Planning application not found.');
  if (input.buildingWarrantApplicationId && !buildingWarrantApplication) throw new HttpError(404, 'Building warrant application not found.');
  if (input.documentSortBatchId && !sortBatch) throw new HttpError(404, 'Document sort batch not found.');

  const requestedDocumentIds = uniqueIds(input.documentIds);
  const batchDocumentIds = sortBatch?.items.map((item) => item.documentId).filter((id): id is string => Boolean(id)) ?? [];
  const documentIds = requestedDocumentIds.length > 0 ? requestedDocumentIds : uniqueIds(batchDocumentIds);

  const documents = documentIds.length > 0
    ? await prisma.projectDocument.findMany({
        where: { id: { in: documentIds }, organisationId: input.organisationId, projectId: project.id },
        orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      })
    : await prisma.projectDocument.findMany({
        where: { organisationId: input.organisationId, projectId: project.id },
        orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      });

  if (documentIds.length > 0 && documents.length !== documentIds.length) {
    throw new HttpError(400, 'One or more documents do not belong to this project.');
  }

  const documentSnapshot = automationJobDocumentSnapshotSchema.parse({
    schemaVersion: 1,
    documents: documents.map(mapDocument),
  });

  const sourceType = inferSourceType(input);
  const applicationQuestions = input.type === AutomationJobType.BUILDING_WARRANT
    ? {
        'Application Profile': buildingWarrantProfileForTypeOfWork(project.projectType),
      }
    : {};
  const dataSnapshot = automationJobSnapshotSchema.parse({
    schemaVersion: 1,
    jobType: input.type,
    sourceType,
    organisation: {
      id: input.organisationId,
      name: input.organisationName,
    },
    project: {
      id: project.id,
      name: project.name,
      internalReference: project.internalReference,
      projectType: project.projectType,
      stage: project.stage,
      status: project.status,
      localAuthority: project.localAuthority,
      siteAddress: project.siteAddress,
      notes: project.notes,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    client: project.client ? {
      id: project.client.id,
      name: project.client.name,
      email: project.client.email,
      phone: project.client.phone,
      address: project.client.address,
      notes: project.client.notes,
    } : null,
    site: project.site ? {
      id: project.site.id,
      addressLine1: project.site.addressLine1,
      addressLine2: project.site.addressLine2,
      townCity: project.site.townCity,
      postcode: project.site.postcode,
      localAuthority: project.site.localAuthority,
      notes: project.site.notes,
    } : null,
    planningApplication: planningApplication ? {
      id: planningApplication.id,
      applicationReference: planningApplication.applicationReference,
      submissionDate: toIso(planningApplication.submissionDate),
      validDate: toIso(planningApplication.validDate),
      decisionTargetDate: toIso(planningApplication.decisionTargetDate),
      decisionDate: toIso(planningApplication.decisionDate),
      status: planningApplication.status,
      portalUrl: planningApplication.portalUrl,
      notes: planningApplication.notes,
    } : null,
    buildingWarrantApplication: buildingWarrantApplication ? {
      id: buildingWarrantApplication.id,
      warrantReference: buildingWarrantApplication.warrantReference,
      warrantType: buildingWarrantApplication.warrantType,
      submissionDate: toIso(buildingWarrantApplication.submissionDate),
      firstResponseTargetDate: toIso(buildingWarrantApplication.firstResponseTargetDate),
      grantedDate: toIso(buildingWarrantApplication.grantedDate),
      expiryDate: toIso(buildingWarrantApplication.expiryDate),
      completionCertificateStatus: buildingWarrantApplication.completionCertificateStatus,
      status: buildingWarrantApplication.status,
      portalUrl: buildingWarrantApplication.portalUrl,
      notes: buildingWarrantApplication.notes,
    } : null,
    applicationQuestions,
    documents: documentSnapshot.documents,
    notes: input.notes ?? null,
    createdAt: new Date().toISOString(),
  });

  assertSafeAutomationSnapshot(dataSnapshot);
  assertSafeAutomationSnapshot(documentSnapshot);

  return {
    title: getJobTitle(input.type, project.name),
    sourceType,
    dataSnapshot,
    documentSnapshot,
  };
};
