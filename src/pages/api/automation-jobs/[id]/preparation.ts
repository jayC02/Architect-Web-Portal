import {
  AutomationJobStatus,
  AutomationJobType,
  DocumentStatus,
  DocumentType,
  type Prisma,
} from '@prisma/client';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { TYPE_OF_WORK_KEYS, type TypeOfWorkKey } from '@/lib/projects/type-of-work';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { clientSchema, organisationDefaultsSchema, siteSchema } from '@/lib/validation/domain';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';
import {
  drainLifecycleEventsBestEffort,
  recordAutomationReadinessTransition,
} from '@/server/services/application-lifecycle.service';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

const optionalText = (limit: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(limit).optional(),
);
const formBoolean = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on',
  z.boolean(),
);
const optionalMoney = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().nonnegative().max(9_999_999_999.99).optional(),
);
const optionalNonNegativeInteger = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().nonnegative().max(999).optional(),
);

const preparationFormSchema = z.object({
  projectName: z.string().trim().min(1).max(160),
  projectType: optionalText(120),
  siteAddressLine1: z.string().trim().min(1).max(160),
  siteAddressLine2: optionalText(160),
  siteTownCity: z.string().trim().min(1).max(100),
  sitePostcode: z.string().trim().min(2).max(20),
  siteLocalAuthority: optionalText(120),
  clientName: z.string().trim().min(1).max(120),
  clientTitle: optionalText(40),
  clientFirstName: optionalText(100),
  clientLastName: optionalText(100),
  clientCompanyName: optionalText(160),
  clientEmail: optionalText(160),
  clientPhone: optionalText(30),
  clientAddressLine1: optionalText(160),
  clientAddressLine2: optionalText(160),
  clientTownCity: optionalText(100),
  clientPostcode: optionalText(20),
  clientCountry: optionalText(100),
  clientNotes: optionalText(2000),
  practiceName: optionalText(160),
  agentFirstName: optionalText(100),
  agentLastName: optionalText(100),
  agentEmail: optionalText(160),
  agentPhone: optionalText(30),
  agentBuildingNumber: optionalText(40),
  agentAddressLine1: optionalText(160),
  agentAddressLine2: optionalText(160),
  agentTownCity: optionalText(100),
  agentPostcode: optionalText(20),
  agentCountry: optionalText(100),
  description: z.string().trim().min(1).max(2000),
  typeOfWorkKeys: z.array(z.enum(TYPE_OF_WORK_KEYS as [TypeOfWorkKey, ...TypeOfWorkKey[]])).min(1).max(TYPE_OF_WORK_KEYS.length),
  estimatedValue: optionalMoney,
  currentUse: optionalText(160),
  proposedUse: optionalText(160),
  selectedCertifierPresetId: optionalText(120),
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
  soleOwner: formBoolean,
  agriculturalHolding: formBoolean,
  discussedWithPlanningAuthority: formBoolean,
  treesOnOrAdjacentToSite: formBoolean,
  newOrAlteredVehicleAccess: formBoolean,
  currentParkingSpaces: optionalNonNegativeInteger,
  proposedParkingSpaces: optionalNonNegativeInteger,
}).superRefine((value, context) => {
  if (!value.newOrAlteredVehicleAccess) return;
  if (value.currentParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['currentParkingSpaces'], message: 'Enter the current parking spaces.' });
  }
  if (value.proposedParkingSpaces === undefined) {
    context.addIssue({ code: 'custom', path: ['proposedParkingSpaces'], message: 'Enter the proposed parking spaces.' });
  }
});

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const editableJobStatuses = new Set<AutomationJobStatus>([
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.READY,
  AutomationJobStatus.STALE,
]);

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-job:preparation');
  const { organisation, user } = await requireOrganisation(context);
  const jobId = context.params.id;
  if (!jobId) throw new HttpError(400, 'Prepared application id is required.');
  const job = await prisma.automationJob.findFirst({
    where: { id: jobId, organisationId: organisation.id },
    include: { project: { include: { client: true, site: true } } },
  });
  if (!job) throw new HttpError(404, 'Prepared application not found.');
  if (!editableJobStatuses.has(job.status)) {
    throw new HttpError(409, 'This prepared application can no longer be edited.');
  }
  const oldSnapshot = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
  if (!oldSnapshot.success) throw new HttpError(409, 'Legacy jobs cannot be edited on this preparation page.');

  const form = await context.request.formData();
  const raw = {
    ...Object.fromEntries(form.entries()),
    typeOfWorkKeys: form.getAll('typeOfWorkKeys').map(String),
  };
  const parsed = preparationFormSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'Check the highlighted application details.', parsed.error.flatten().fieldErrors);
  }
  const value = parsed.data;

  const clientData = clientSchema.parse({
    name: value.clientName,
    title: value.clientTitle,
    firstName: value.clientFirstName,
    lastName: value.clientLastName,
    companyName: value.clientCompanyName,
    email: value.clientEmail,
    phone: value.clientPhone,
    addressLine1: value.clientAddressLine1,
    addressLine2: value.clientAddressLine2,
    townCity: value.clientTownCity,
    postcode: value.clientPostcode,
    country: value.clientCountry ?? 'United Kingdom',
    notes: value.clientNotes,
    address: [value.clientAddressLine1, value.clientAddressLine2, value.clientTownCity, value.clientPostcode]
      .filter(Boolean).join(', ') || undefined,
  });
  const siteData = siteSchema.parse({
    addressLine1: value.siteAddressLine1,
    addressLine2: value.siteAddressLine2,
    townCity: value.siteTownCity,
    postcode: value.sitePostcode,
    localAuthority: value.siteLocalAuthority,
  });
  const defaultsData = organisationDefaultsSchema.parse({
    practiceName: value.practiceName,
    agentFirstName: value.agentFirstName,
    agentLastName: value.agentLastName,
    agentEmail: value.agentEmail,
    agentPhone: value.agentPhone,
    agentBuildingNumber: value.agentBuildingNumber,
    agentAddressLine1: value.agentAddressLine1,
    agentAddressLine2: value.agentAddressLine2,
    agentTownCity: value.agentTownCity,
    agentPostcode: value.agentPostcode,
    agentCountry: value.agentCountry ?? 'United Kingdom',
  });
  if (value.selectedCertifierPresetId) {
    const certifier = await prisma.organisationCertifierPreset.findFirst({
      where: { id: value.selectedCertifierPresetId, organisationId: organisation.id },
      select: { id: true },
    });
    if (!certifier) throw new HttpError(400, 'Choose a valid organisation certifier preset.');
  }

  const client = job.project.client
    ? await prisma.client.update({
        where: { id: job.project.client.id },
        data: clientData,
      })
    : await prisma.client.create({
        data: { organisationId: organisation.id, ...clientData },
      });
  const site = job.project.site
    ? await prisma.site.update({
        where: { id: job.project.site.id },
        data: siteData,
      })
    : await prisma.site.create({
        data: { organisationId: organisation.id, ...siteData },
      });

  await Promise.all([
    prisma.project.updateMany({
      where: { id: job.projectId, organisationId: organisation.id },
      data: {
        name: value.projectName,
        projectType: job.type === AutomationJobType.BUILDING_WARRANT
          ? value.typeOfWorkKeys[0]
          : value.projectType ?? null,
        clientId: client.id,
        siteId: site.id,
        siteAddress: siteData.addressLine1,
        localAuthority: siteData.localAuthority,
      },
    }),
    prisma.organisationDefaults.upsert({
      where: { organisationId: organisation.id },
      create: { organisationId: organisation.id, ...defaultsData },
      update: defaultsData,
    }),
  ]);

  if (job.type === AutomationJobType.BUILDING_WARRANT) {
    const recordId = oldSnapshot.data.buildingWarrant?.recordId;
    if (!recordId) throw new HttpError(409, 'Building Warrant record is missing.');
    const previous = jsonObject((await prisma.buildingWarrantApplication.findFirst({
      where: { id: recordId, organisationId: organisation.id, projectId: job.projectId },
      select: { preparationData: true },
    }))?.preparationData);
    await prisma.buildingWarrantApplication.updateMany({
      where: { id: recordId, organisationId: organisation.id, projectId: job.projectId },
      data: {
        description: value.description,
        presetKey: value.typeOfWorkKeys[0],
        estimatedValue: value.estimatedValue,
        currentUse: value.currentUse,
        proposedUse: value.proposedUse,
        selectedCertifierPresetId: value.selectedCertifierPresetId,
        preparationData: {
          ...previous,
          typeOfWorkKeys: value.typeOfWorkKeys,
          applicantIsOwner: value.applicantIsOwner,
          applicationIsStaged: value.applicationIsStaged,
          intendedLifeFiveYearsOrLess: value.intendedLifeFiveYearsOrLess,
          fireAndRescueServiceEnforcingAuthority: value.fireAndRescueServiceEnforcingAuthority,
          listedBuildingOrConservationArea: value.listedBuildingOrConservationArea,
          otherHistoricalImportance: value.otherHistoricalImportance,
          scottishMinistersRelaxationDirection: value.scottishMinistersRelaxationDirection,
          dangerousBuildingNotice: value.dangerousBuildingNotice,
          approvedCertifierOfConstruction: value.approvedCertifierOfConstruction,
          coveredBySTAS: value.coveredBySTAS,
          restrictPublicInspection: value.restrictPublicInspection,
        },
        reviewedAt: new Date(),
      },
    });
  } else {
    const recordId = oldSnapshot.data.planning?.recordId;
    if (!recordId) throw new HttpError(409, 'Planning record is missing.');
    const previous = jsonObject((await prisma.planningApplication.findFirst({
      where: { id: recordId, organisationId: organisation.id, projectId: job.projectId },
      select: { preparationData: true },
    }))?.preparationData);
    await prisma.planningApplication.updateMany({
      where: { id: recordId, organisationId: organisation.id, projectId: job.projectId },
      data: {
        description: value.description,
        preparationData: {
          ...previous,
          soleOwner: value.soleOwner,
          agriculturalHolding: value.agriculturalHolding,
          discussedWithPlanningAuthority: value.discussedWithPlanningAuthority,
          treesOnOrAdjacentToSite: value.treesOnOrAdjacentToSite,
          newOrAlteredVehicleAccess: value.newOrAlteredVehicleAccess,
          currentParkingSpaces: value.newOrAlteredVehicleAccess ? value.currentParkingSpaces : undefined,
          proposedParkingSpaces: value.newOrAlteredVehicleAccess ? value.proposedParkingSpaces : undefined,
        },
        reviewedAt: new Date(),
      },
    });
  }

  const documentIds = form.getAll('documentId').map(String);
  const documentTypes = form.getAll('documentType').map(String);
  const revisions = form.getAll('documentRevision').map(String);
  const titles = form.getAll('documentTitle').map(String);
  for (const [index, documentId] of documentIds.entries()) {
    const type = z.nativeEnum(DocumentType).safeParse(documentTypes[index]);
    if (!type.success) throw new HttpError(400, 'Choose a valid document type.');
    await prisma.projectDocument.updateMany({
      where: { id: documentId, organisationId: organisation.id, projectId: job.projectId },
      data: {
        type: type.data,
        revision: revisions[index]?.trim() || null,
        drawingTitle: titles[index]?.trim() || null,
        status: DocumentStatus.APPROVED,
      },
    });
  }

  const refreshed = await buildAutomationJobSnapshot({
    jobId: job.id,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId: job.projectId,
    type: job.type,
    createdBy: { id: user.id, name: user.name, email: user.email },
    planningApplicationId: oldSnapshot.data.planning?.recordId ?? undefined,
    buildingWarrantApplicationId: oldSnapshot.data.buildingWarrant?.recordId ?? undefined,
    documentIds: documentIds.length ? documentIds : oldSnapshot.data.documents.map((document) => document.id),
  });
  const nextStatus = refreshed.preflight.status === 'READY'
    ? AutomationJobStatus.READY
    : AutomationJobStatus.NEEDS_INPUT;
  const readinessLifecycleEvent = await prisma.$transaction(async (tx) => {
    await tx.automationJob.updateMany({
      where: { id: job.id, organisationId: organisation.id },
      data: {
        title: refreshed.title,
        status: nextStatus,
        sourceType: refreshed.sourceType,
        payloadVersion: 2,
        snapshotHash: refreshed.snapshotHash,
        sourceUpdatedAt: refreshed.sourceUpdatedAt,
        preparedAt: new Date(),
        reviewedAt: new Date(),
        dataSnapshot: refreshed.dataSnapshot as Prisma.InputJsonValue,
        documentSnapshot: refreshed.documentSnapshot as Prisma.InputJsonValue,
      },
    });
    return recordAutomationReadinessTransition(tx, {
      organisationId: organisation.id,
      projectId: job.projectId,
      jobType: job.type,
      previousStatus: job.status,
      nextStatus,
      readinessKey: refreshed.snapshotHash,
      planningApplicationId: oldSnapshot.data.planning?.recordId,
      buildingWarrantApplicationId: oldSnapshot.data.buildingWarrant?.recordId,
      actorUserId: user.id,
    });
  });
  const draft = await persistApplicationPreparationDraft(job.id, organisation.id);
  await drainLifecycleEventsBestEffort(organisation.id, [readinessLifecycleEvent?.id]);
  return jsonResponse(200, {
    message: refreshed.preflight.status === 'READY'
      ? 'Application details saved. This job is ready for desktop.'
      : 'Application details saved. A few details still need attention.',
    readiness: refreshed.preflight,
    draft,
    redirectTo: `/automation-job/${job.id}`,
  });
}, context);

export const prerender = false;
