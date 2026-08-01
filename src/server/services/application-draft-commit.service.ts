import { randomUUID } from 'node:crypto';
import {
  ApplicationDraftStatus,
  ApplicationDraftType,
  AutomationJobSourceType,
  AutomationJobStatus,
  AutomationJobType,
  DocumentSortSource,
  PlanningStatus,
  Prisma,
  ProjectStage,
  ProjectStatus,
  WarrantStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  applicationDraftReviewSchema,
  type ApplicationDraftReview,
} from '@/lib/validation/application-draft';
import { HttpError } from '@/lib/utils/http';
import {
  buildAutomationJobSnapshot,
} from '@/server/services/automation-jobs.service';
import {
  evaluateApplicationDraftReadiness,
  getApplicationDraftForOrganisation,
} from '@/server/services/application-draft.service';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';

type CommitUser = {
  id: string;
  name: string;
  email: string;
};

type CommitOrganisation = {
  id: string;
  name: string;
};

const applicationTypeToJobType = (type: ApplicationDraftType): AutomationJobType => {
  if (type === ApplicationDraftType.BUILDING_WARRANT) return AutomationJobType.BUILDING_WARRANT;
  if (type === ApplicationDraftType.PLANNING_APPLICATION) return AutomationJobType.PLANNING_APPLICATION;
  if (type === ApplicationDraftType.HOUSEHOLDER_PLANNING) return AutomationJobType.HOUSEHOLDER_PLANNING;
  throw new HttpError(409, 'Choose an application route before creating the project.');
};

const projectStageFor = (type: ApplicationDraftType) =>
  type === ApplicationDraftType.BUILDING_WARRANT
    ? ProjectStage.BUILDING_WARRANT
    : ProjectStage.PLANNING;

const displayNameFor = (person: ApplicationDraftReview['client']) =>
  person.displayName?.trim()
  || person.companyName?.trim()
  || [person.firstName, person.lastName].filter(Boolean).join(' ').trim();

const joinedAddress = (person: ApplicationDraftReview['client']) =>
  [
    person.addressLine1,
    person.addressLine2,
    person.townCity,
    person.postcode,
    person.country,
  ].filter(Boolean).join(', ') || null;

const personSnapshotOverride = (
  person: ApplicationDraftReview['client'] | ApplicationDraftReview['applicant'],
) => person ? {
  clientType: person.clientType,
  displayName: person.displayName,
  title: person.title,
  firstName: person.firstName,
  lastName: person.lastName,
  companyName: person.companyName,
  email: person.email,
  phone: person.phone,
  address: {
    addressLine1: person.addressLine1,
    addressLine2: person.addressLine2,
    townCity: person.townCity,
    postcode: person.postcode,
    country: person.country,
  },
} : null;

const agentSnapshotOverride = (agent: ApplicationDraftReview['agent']) => ({
  practiceName: agent.practiceName,
  firstName: agent.firstName,
  lastName: agent.lastName,
  email: agent.email,
  phone: agent.phone,
  address: {
    addressLine1: agent.addressLine1,
    addressLine2: agent.addressLine2,
    townCity: agent.townCity,
    postcode: agent.postcode,
    country: agent.country,
  },
});

const planningAnswers = (review: ApplicationDraftReview) => ({
  discussedWithPlanningAuthority: review.confirmations.discussedWithPlanningAuthority === true,
  treesOnOrAdjacentToSite: review.confirmations.treesOnOrAdjacentToSite === true,
  newOrAlteredVehicleAccess: review.confirmations.newOrAlteredVehicleAccess === true,
  ...(review.confirmations.newOrAlteredVehicleAccess === true ? {
    currentParkingSpaces: Number(review.confirmations.currentParkingSpaces),
    proposedParkingSpaces: Number(review.confirmations.proposedParkingSpaces),
  } : {}),
  soleOwner: review.confirmations.soleOwner as boolean,
  agriculturalHolding: review.confirmations.agriculturalHolding as boolean,
  applicantOverride: review.applicantDifferentFromClient
    ? personSnapshotOverride(review.applicant)
    : null,
  agentOverride: agentSnapshotOverride(review.agent),
});

const selectedTypeOfWorkKeys = (review: ApplicationDraftReview) =>
  review.application.typeOfWorkKeys.length
    ? review.application.typeOfWorkKeys
    : review.project.typeOfWorkKey ? [review.project.typeOfWorkKey] : [];

const buildingWarrantAnswers = (review: ApplicationDraftReview) => ({
  typeOfWorkKeys: selectedTypeOfWorkKeys(review),
  applicantIsOwner: review.confirmations.applicantIsOwner as boolean,
  applicationIsStaged: review.confirmations.applicationIsStaged as boolean,
  intendedLifeFiveYearsOrLess: review.confirmations.intendedLifeFiveYearsOrLess as boolean,
  fireAndRescueServiceEnforcingAuthority: review.confirmations.fireAndRescueServiceEnforcingAuthority as boolean,
  listedBuildingOrConservationArea: review.confirmations.listedBuildingOrConservationArea as boolean,
  otherHistoricalImportance: review.confirmations.otherHistoricalImportance as boolean,
  scottishMinistersRelaxationDirection: review.confirmations.scottishMinistersRelaxationDirection as boolean,
  dangerousBuildingNotice: review.confirmations.dangerousBuildingNotice as boolean,
  approvedCertifierOfConstruction: review.confirmations.approvedCertifierOfConstruction as boolean,
  coveredBySTAS: review.confirmations.coveredBySTAS as boolean,
  restrictPublicInspection: review.confirmations.restrictPublicInspection as boolean,
  applicantOverride: review.applicantDifferentFromClient
    ? personSnapshotOverride(review.applicant)
    : null,
  agentOverride: agentSnapshotOverride(review.agent),
});

const validateSelectedRecords = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  review: ApplicationDraftReview,
) => {
  const [client, site, project, certifier] = await Promise.all([
    review.clientMode === 'existing' && review.existingClientId
      ? tx.client.findFirst({ where: { id: review.existingClientId, organisationId } })
      : Promise.resolve(null),
    review.siteMode === 'existing' && review.existingSiteId
      ? tx.site.findFirst({ where: { id: review.existingSiteId, organisationId } })
      : Promise.resolve(null),
    review.projectMode === 'existing' && review.existingProjectId
      ? tx.project.findFirst({ where: { id: review.existingProjectId, organisationId } })
      : Promise.resolve(null),
    review.application.selectedCertifierPresetId
      ? tx.organisationCertifierPreset.findFirst({
          where: { id: review.application.selectedCertifierPresetId, organisationId },
        })
      : Promise.resolve(null),
  ]);
  if (review.clientMode === 'existing' && !client) throw new HttpError(404, 'The selected client is not available.');
  if (review.siteMode === 'existing' && !site) throw new HttpError(404, 'The selected site is not available.');
  if (review.projectMode === 'existing' && !project) throw new HttpError(404, 'The selected project is not available.');
  if (review.application.selectedCertifierPresetId && !certifier) {
    throw new HttpError(404, 'The selected certifier preset is not available.');
  }
  return { client, site, project };
};

const resolvePermanentRecords = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  review: ApplicationDraftReview,
) => {
  const selected = await validateSelectedRecords(tx, organisationId, review);
  if (selected.project) {
    return {
      clientId: selected.project.clientId,
      siteId: selected.project.siteId,
      projectId: selected.project.id,
    };
  }

  const clientId = selected.client?.id ?? (await tx.client.create({
    data: {
      organisationId,
      name: displayNameFor(review.client),
      email: review.client.email,
      phone: review.client.phone,
      address: joinedAddress(review.client),
      title: review.client.title,
      firstName: review.client.firstName,
      lastName: review.client.lastName,
      companyName: review.client.companyName,
      addressLine1: review.client.addressLine1,
      addressLine2: review.client.addressLine2,
      townCity: review.client.townCity,
      postcode: review.client.postcode,
      country: review.client.country,
    },
    select: { id: true },
  })).id;
  const siteId = selected.site?.id ?? (await tx.site.create({
    data: {
      organisationId,
      addressLine1: review.site.addressLine1!,
      addressLine2: review.site.addressLine2,
      townCity: review.site.townCity!,
      postcode: review.site.postcode!,
      localAuthority: review.site.localAuthority,
    },
    select: { id: true },
  })).id;
  const project = await tx.project.create({
    data: {
      organisationId,
      clientId,
      siteId,
      name: review.project.name!,
      internalReference: review.project.internalReference,
      projectType: selectedTypeOfWorkKeys(review)[0] ?? review.project.typeOfWorkKey,
      stage: projectStageFor(review.selectedApplicationType),
      localAuthority: review.site.localAuthority,
      siteAddress: [
        review.site.addressLine1,
        review.site.addressLine2,
        review.site.townCity,
        review.site.postcode,
      ].filter(Boolean).join(', '),
      status: ProjectStatus.ACTIVE,
      notes: review.project.summary,
    },
    select: { id: true },
  });
  return { clientId, siteId, projectId: project.id };
};

const ensureReviewedDocumentsMatch = (
  draftDocumentIds: string[],
  review: ApplicationDraftReview,
) => {
  const reviewedIds = review.documents.map((document) => document.id);
  if (
    draftDocumentIds.length !== reviewedIds.length
    || new Set(reviewedIds).size !== reviewedIds.length
    || draftDocumentIds.some((id) => !reviewedIds.includes(id))
  ) {
    throw new HttpError(409, 'The uploaded document list changed. Reload the draft and review it again.');
  }
};

export const commitApplicationDraft = async (
  draftId: string,
  organisation: CommitOrganisation,
  user: CommitUser,
  submittedReview: unknown,
) => {
  const review = applicationDraftReviewSchema.parse(submittedReview);
  const issues = evaluateApplicationDraftReadiness(review);
  if (issues.length) {
    throw new HttpError(409, 'Review the remaining application details before creating it.', { issues });
  }

  const initialDraft = await getApplicationDraftForOrganisation(draftId, organisation.id);
  if (initialDraft.status === ApplicationDraftStatus.CANCELLED) {
    throw new HttpError(409, 'This application draft was cancelled.');
  }
  if (initialDraft.status === ApplicationDraftStatus.EXPIRED || initialDraft.expiresAt <= new Date()) {
    throw new HttpError(410, 'This application draft has expired.');
  }
  if (initialDraft.status === ApplicationDraftStatus.COMMITTED) {
    return {
      created: false,
      projectId: initialDraft.resultingProjectId!,
      planningId: initialDraft.resultingPlanningId,
      warrantId: initialDraft.resultingWarrantId,
      automationJobId: initialDraft.resultingAutomationJobId!,
    };
  }
  ensureReviewedDocumentsMatch(initialDraft.documents.map((document) => document.id), review);

  const jobType = applicationTypeToJobType(review.selectedApplicationType);
  const existingJobId = initialDraft.resultingAutomationJobId;
  const jobId = existingJobId ?? randomUUID();

  const committedRecords = await prisma.$transaction(async (tx) => {
    const current = await tx.applicationDraft.findFirst({
      where: { id: draftId, organisationId: organisation.id },
      include: { documents: true },
    });
    if (!current) throw new HttpError(404, 'Application draft not found.');
    if (current.status === ApplicationDraftStatus.COMMITTED) {
      return {
        projectId: current.resultingProjectId!,
        planningId: current.resultingPlanningId,
        warrantId: current.resultingWarrantId,
        automationJobId: current.resultingAutomationJobId!,
      };
    }
    if (current.status === ApplicationDraftStatus.COMMITTING && current.resultingProjectId) {
      return {
        projectId: current.resultingProjectId,
        planningId: current.resultingPlanningId,
        warrantId: current.resultingWarrantId,
        automationJobId: current.resultingAutomationJobId ?? jobId,
      };
    }
    const locked = await tx.applicationDraft.updateMany({
      where: {
        id: draftId,
        organisationId: organisation.id,
        status: {
          in: [
            ApplicationDraftStatus.NEEDS_REVIEW,
            ApplicationDraftStatus.READY_TO_CREATE,
            ApplicationDraftStatus.FAILED,
          ],
        },
      },
      data: {
        status: ApplicationDraftStatus.COMMITTING,
        confirmedData: review as Prisma.InputJsonValue,
        selectedApplicationType: review.selectedApplicationType,
      },
    });
    if (!locked.count) throw new HttpError(409, 'This application draft is already being created.');

    const records = await resolvePermanentRecords(tx, organisation.id, review);
    const reviewById = new Map(review.documents.map((document) => [document.id, document]));
    for (const document of current.documents) {
      const reviewed = reviewById.get(document.id)!;
      const permanent = document.committedDocumentId
        ? await tx.projectDocument.findFirst({
            where: {
              id: document.committedDocumentId,
              organisationId: organisation.id,
              projectId: records.projectId,
            },
            select: { id: true },
          })
        : null;
      const permanentId = permanent?.id ?? (await tx.projectDocument.create({
        data: {
          organisationId: organisation.id,
          projectId: records.projectId,
          uploadedById: user.id,
          fileName: document.fileName,
          originalName: document.originalFilename,
          storageUrl: '',
          storageKey: document.storageKey,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          type: reviewed.documentType,
          revision: reviewed.revision,
          status: reviewed.documentStatus,
          drawingNumber: reviewed.drawingNumber,
          drawingTitle: reviewed.drawingTitle,
          sortSource: document.classificationSource ?? DocumentSortSource.MANUAL,
          sortConfidence: document.confidence,
          sortReason: document.classificationReason,
          fileHash: document.sha256,
          analysisVersion: document.analysisVersion,
          analysisProvider: document.analysisProvider,
          analysisModel: document.analysisModel,
          analysisPromptVersion: document.analysisPromptVersion,
          analysisSchemaVersion: document.analysisSchemaVersion,
          analysisStatus: document.analysisStatus,
          analysisResult: document.analysisResult ?? Prisma.JsonNull,
          analysedAt: document.analysisResult ? document.updatedAt : null,
        },
        select: { id: true },
      })).id;
      await tx.applicationDraftDocument.update({
        where: { id: document.id },
        data: {
          committedDocumentId: permanentId,
          documentType: reviewed.documentType,
          documentStatus: reviewed.documentStatus,
          revision: reviewed.revision,
          drawingNumber: reviewed.drawingNumber,
          drawingTitle: reviewed.drawingTitle,
        },
      });
    }

    let planningId: string | null = null;
    let warrantId: string | null = null;
    if (review.selectedApplicationType === ApplicationDraftType.BUILDING_WARRANT) {
      warrantId = (await tx.buildingWarrantApplication.create({
        data: {
          organisationId: organisation.id,
          projectId: records.projectId,
          status: WarrantStatus.DRAFTING,
          presetKey: selectedTypeOfWorkKeys(review)[0],
          description: review.application.description,
          estimatedValue: review.application.estimatedValue,
          currentUse: review.application.currentUse,
          proposedUse: review.application.proposedUse,
          preparationData: buildingWarrantAnswers(review) as Prisma.InputJsonValue,
          selectedCertifierPresetId: review.application.selectedCertifierPresetId,
          preparedAt: new Date(),
        },
        select: { id: true },
      })).id;
    } else {
      planningId = (await tx.planningApplication.create({
        data: {
          organisationId: organisation.id,
          projectId: records.projectId,
          status: PlanningStatus.DRAFTING,
          description: review.application.description,
          preparationData: planningAnswers(review) as Prisma.InputJsonValue,
          preparedAt: new Date(),
        },
        select: { id: true },
      })).id;
    }

    if (review.agent.saveAsOrganisationDefault) {
      await tx.organisationDefaults.upsert({
        where: { organisationId: organisation.id },
        create: {
          organisationId: organisation.id,
          practiceName: review.agent.practiceName,
          agentFirstName: review.agent.firstName,
          agentLastName: review.agent.lastName,
          agentEmail: review.agent.email,
          agentPhone: review.agent.phone,
          agentAddressLine1: review.agent.addressLine1,
          agentAddressLine2: review.agent.addressLine2,
          agentTownCity: review.agent.townCity,
          agentPostcode: review.agent.postcode,
          agentCountry: review.agent.country ?? 'United Kingdom',
        },
        update: {
          practiceName: review.agent.practiceName,
          agentFirstName: review.agent.firstName,
          agentLastName: review.agent.lastName,
          agentEmail: review.agent.email,
          agentPhone: review.agent.phone,
          agentAddressLine1: review.agent.addressLine1,
          agentAddressLine2: review.agent.addressLine2,
          agentTownCity: review.agent.townCity,
          agentPostcode: review.agent.postcode,
          agentCountry: review.agent.country ?? 'United Kingdom',
        },
      });
    }

    await tx.applicationDraft.update({
      where: { id: current.id },
      data: {
        status: ApplicationDraftStatus.COMMITTING,
        confirmedData: review as Prisma.InputJsonValue,
        unresolvedQuestions: [],
        resultingProjectId: records.projectId,
        resultingPlanningId: planningId,
        resultingWarrantId: warrantId,
        resultingAutomationJobId: jobId,
      },
    });
    return {
      projectId: records.projectId,
      planningId,
      warrantId,
      automationJobId: jobId,
    };
  });

  const snapshot = await buildAutomationJobSnapshot({
    jobId: committedRecords.automationJobId,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId: committedRecords.projectId,
    type: jobType,
    createdBy: user,
    sourceType: committedRecords.warrantId
      ? AutomationJobSourceType.WARRANT_RECORD
      : AutomationJobSourceType.PLANNING_RECORD,
    planningApplicationId: committedRecords.planningId ?? undefined,
    buildingWarrantApplicationId: committedRecords.warrantId ?? undefined,
  });
  await prisma.automationJob.upsert({
    where: { id: committedRecords.automationJobId },
    create: {
      id: committedRecords.automationJobId,
      organisationId: organisation.id,
      projectId: committedRecords.projectId,
      type: jobType,
      status: snapshot.preflight.status === 'READY'
        ? AutomationJobStatus.READY
        : AutomationJobStatus.NEEDS_INPUT,
      sourceType: snapshot.sourceType,
      title: snapshot.title,
      payloadVersion: 2,
      snapshotHash: snapshot.snapshotHash,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      preparedAt: new Date(),
      reviewedAt: new Date(),
      dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
      documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
      createdById: user.id,
    },
    update: {
      type: jobType,
      status: snapshot.preflight.status === 'READY'
        ? AutomationJobStatus.READY
        : AutomationJobStatus.NEEDS_INPUT,
      sourceType: snapshot.sourceType,
      title: snapshot.title,
      payloadVersion: 2,
      snapshotHash: snapshot.snapshotHash,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      preparedAt: new Date(),
      reviewedAt: new Date(),
      dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
      documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
    },
  });
  await persistApplicationPreparationDraft(committedRecords.automationJobId, organisation.id);
  await prisma.applicationDraft.updateMany({
    where: {
      id: draftId,
      organisationId: organisation.id,
      resultingAutomationJobId: committedRecords.automationJobId,
    },
    data: {
      status: ApplicationDraftStatus.COMMITTED,
      committedAt: new Date(),
      unresolvedQuestions: [],
    },
  });

  return {
    created: true,
    ...committedRecords,
  };
};
