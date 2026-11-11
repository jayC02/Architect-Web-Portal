import { createHash } from 'node:crypto';
import {
  AutomationJobSourceType,
  AutomationJobType,
  WarrantType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  COMPLETION_FIXED_ANSWERS,
  completionIssues,
  completionPrefill,
  mergeCompletionPreparation,
  type CompletionIssue,
  type CompletionParties,
  type CompletionPreparation,
} from '@/lib/completion-certificate';
import { readProjectScreener } from '@/lib/projects/screener';
import { HttpError } from '@/lib/utils/http';
import {
  assertSafeAutomationSnapshot,
  automationJobSnapshotV2Schema,
  completionCertificateSnapshotSchema,
} from '@/lib/validation/automation-job';
import {
  canonicalJson,
  maxDate,
  snapshotClientApplicant,
  snapshotOrganisationAgent,
  snapshotProject,
  snapshotSite,
} from '@/server/services/automation-jobs.service';

type Database = Prisma.TransactionClient;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const completionWarrantInclude = {
  project: { include: { client: true, site: true } },
  selectedCertifierPreset: true,
} satisfies Prisma.BuildingWarrantApplicationInclude;

type CompletionWarrant = Prisma.BuildingWarrantApplicationGetPayload<{ include: typeof completionWarrantInclude }>;

export type CompletionContext = {
  warrant: CompletionWarrant;
  defaults: Prisma.OrganisationDefaultsGetPayload<{ include: { defaultCertifierPreset: true } }> | null;
  amendmentGrantedDates: Date[];
  documents: Array<{ id: string; name: string }>;
};

/** Everything the completion certificate needs, scoped to the organisation. */
export const loadCompletionContext = async (
  input: { organisationId: string; warrantId: string },
  database: Database = prisma,
): Promise<CompletionContext> => {
  const warrant = await database.buildingWarrantApplication.findFirst({
    where: { id: input.warrantId, organisationId: input.organisationId },
    include: completionWarrantInclude,
  });
  if (!warrant) throw new HttpError(404, 'Building warrant application not found.');
  const [defaults, amendments, documents] = await Promise.all([
    database.organisationDefaults.findUnique({
      where: { organisationId: input.organisationId },
      include: { defaultCertifierPreset: true },
    }),
    database.buildingWarrantApplication.findMany({
      where: {
        organisationId: input.organisationId,
        projectId: warrant.projectId,
        warrantType: WarrantType.AMENDMENT,
        grantedDate: { not: null },
      },
      select: { grantedDate: true },
      orderBy: { grantedDate: 'asc' },
      take: 50,
    }),
    database.projectDocument.findMany({
      where: { organisationId: input.organisationId, projectId: warrant.projectId },
      select: { id: true, originalName: true, fileName: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);
  return {
    warrant,
    defaults,
    amendmentGrantedDates: amendments.map((row) => row.grantedDate).filter((date): date is Date => Boolean(date)),
    documents: documents.map((document) => ({ id: document.id, name: document.originalName || document.fileName })),
  };
};

/** Saved answers over warrant prefill, with what is still missing. */
export const completionPreparationFor = (context: CompletionContext, today: Date = new Date()): {
  preparation: CompletionPreparation;
  issues: CompletionIssue[];
  parties: CompletionParties;
} => {
  const { warrant, defaults } = context;
  const warrantPreparation = objectValue(warrant.preparationData);
  const savedCertifier = objectValue(warrantPreparation.certifier);
  const preset = warrant.selectedCertifierPreset ?? defaults?.defaultCertifierPreset ?? null;
  const certifierValue = (key: 'registrationAPart1' | 'registrationAPart2' | 'registrationBPart1' | 'registrationBPart2') =>
    (typeof savedCertifier[key] === 'string' && savedCertifier[key] ? savedCertifier[key] as string : preset?.[key]) ?? null;
  const prefill = completionPrefill({
    warrantReference: warrant.warrantReference,
    grantedDate: warrant.grantedDate,
    amendmentGrantedDates: context.amendmentGrantedDates,
    warrantPreparation,
    certifier: {
      registrationAPart1: certifierValue('registrationAPart1'),
      registrationAPart2: certifierValue('registrationAPart2'),
      registrationBPart1: certifierValue('registrationBPart1'),
      registrationBPart2: certifierValue('registrationBPart2'),
    },
  });
  const preparation = mergeCompletionPreparation(warrant.completionPreparationData, prefill);
  const client = warrant.project.client;
  const parties: CompletionParties = {
    client: client ? {
      title: client.title,
      firstName: client.firstName,
      lastName: client.lastName,
      buildingNumber: client.buildingNumber,
      addressLine1: client.addressLine1 ?? client.address,
      townCity: client.townCity,
      postcode: client.postcode,
      country: client.country,
    } : null,
    agent: {
      firstName: defaults?.agentFirstName ?? null,
      lastName: defaults?.agentLastName ?? null,
      email: defaults?.agentEmail ?? null,
      phone: defaults?.agentPhone ?? null,
      buildingNumber: defaults?.agentBuildingNumber ?? null,
      addressLine1: defaults?.agentAddressLine1 ?? null,
      townCity: defaults?.agentTownCity ?? null,
      postcode: defaults?.agentPostcode ?? null,
      country: defaults?.agentCountry ?? null,
    },
  };
  return { preparation, issues: completionIssues(preparation, parties, today), parties };
};

/** Reviewed answers with anything that does not apply cleared. */
const resolvedAnswers = (preparation: CompletionPreparation) => {
  const constructionAccompany = preparation.constructionCertificates.accompany === true;
  const designAccompanied = preparation.designCertificates.accompaniedWarrant === true;
  const formQRequired = designAccompanied ? preparation.designCertificates.formQRequired : null;
  const relaxationApplies = preparation.relaxation.applies === true;
  const continuingApplies = preparation.continuingRequirements.applies === true;
  return {
    workCompletedDate: preparation.workCompletedDate,
    warrantReference: preparation.warrantReference?.trim() ?? null,
    warrantDate: preparation.warrantDate,
    amendmentDates: preparation.amendmentDates?.trim() ? preparation.amendmentDates : null,
    relaxation: {
      applies: relaxationApplies,
      reference: relaxationApplies ? preparation.relaxation.reference?.trim() ?? null : null,
      date: relaxationApplies ? preparation.relaxation.date : null,
    },
    constructionCertificates: {
      accompany: constructionAccompany,
      entries: constructionAccompany ? preparation.constructionCertificates.entries : [],
    },
    designCertificates: {
      accompaniedWarrant: designAccompanied,
      formQRequired,
      entries: formQRequired ? preparation.designCertificates.entries : [],
    },
    energyPerformanceCertificate: preparation.energyPerformanceCertificate,
    sustainabilityStatement: preparation.sustainabilityStatement,
    fireSafetyDesignSummary: preparation.fireSafetyDesignSummary,
    continuingRequirements: {
      applies: continuingApplies,
      details: continuingApplies ? preparation.continuingRequirements.details : null,
    },
  };
};

export type BuildCompletionCertificateSnapshotInput = {
  jobId: string;
  createdAt: Date;
  organisationId: string;
  organisationName: string;
  warrantId: string;
  createdBy: { id: string; name: string; email: string };
};

/**
 * Immutable job snapshot for one Completion Certificate run.
 *
 * Unlike warrant and planning jobs there is no "needs input" snapshot: a
 * completion job only exists once every answer has been reviewed.
 */
export const buildCompletionCertificateSnapshot = async (
  input: BuildCompletionCertificateSnapshotInput,
  database: Database = prisma,
  today: Date = new Date(),
) => {
  const context = await loadCompletionContext(input, database);
  const { preparation, issues } = completionPreparationFor(context, today);
  if (issues.length) {
    throw new HttpError(409, 'Complete the missing completion certificate details first.', { issues });
  }
  const { warrant, defaults } = context;
  const project = warrant.project;
  const site = snapshotSite(project);
  const sourceUpdatedAt = maxDate([
    warrant.updatedAt,
    project.updatedAt,
    project.client?.updatedAt,
    project.site?.updatedAt,
    defaults?.updatedAt,
  ]);
  const completionCertificate = completionCertificateSnapshotSchema.parse({
    sourceWarrantId: warrant.id,
    proposalHint: {
      proposalName: [site.address.addressLine1, site.address.townCity, site.address.postcode]
        .filter((part): part is string => Boolean(part?.trim())).join(', ') || null,
    },
    ...resolvedAnswers(preparation),
    fixedAnswers: COMPLETION_FIXED_ANSWERS,
    updatedAt: warrant.updatedAt.toISOString(),
  });
  const preflight = {
    status: 'READY' as const,
    missing: [],
    warnings: [],
    locationPlanStatus: 'NOT_APPLICABLE' as const,
    reviewedAt: null,
  };
  const withoutIntegrity = {
    contractVersion: 'architectpro.automation-job' as const,
    snapshotVersion: 2 as const,
    metadata: {
      jobId: input.jobId,
      organisationId: input.organisationId,
      projectId: project.id,
      applicationType: AutomationJobType.COMPLETION_CERTIFICATE,
      sourceType: AutomationJobSourceType.WARRANT_RECORD,
      createdAt: input.createdAt.toISOString(),
      createdBy: input.createdBy,
      sourceUpdatedAt: sourceUpdatedAt.toISOString(),
      presetVersion: warrant.presetVersion ?? 1,
      integrity: null,
    },
    organisation: {
      id: input.organisationId,
      name: input.organisationName,
      practiceName: defaults?.practiceName ?? input.organisationName,
      agent: snapshotOrganisationAgent(defaults),
    },
    project: snapshotProject(project, readProjectScreener(project), site.localAuthority),
    site,
    // The relevant person is the client. Ownership is a fixed answer for now.
    applicant: snapshotClientApplicant(project.client, COMPLETION_FIXED_ANSWERS.relevantPersonIsOwner),
    planning: null,
    buildingWarrant: null,
    completionCertificate,
    documents: [],
    preflight,
  };
  const integrity = `sha256:${createHash('sha256').update(canonicalJson(withoutIntegrity)).digest('hex')}`;
  const dataSnapshot = automationJobSnapshotV2Schema.parse({
    ...withoutIntegrity,
    metadata: { ...withoutIntegrity.metadata, integrity },
  });
  assertSafeAutomationSnapshot(dataSnapshot);
  return {
    title: `Completion Certificate - ${project.name}`,
    sourceType: AutomationJobSourceType.WARRANT_RECORD,
    dataSnapshot,
    documentSnapshot: { schemaVersion: 2 as const, documents: [] as never[] },
    snapshotHash: integrity,
    sourceUpdatedAt,
    preflight,
    projectId: project.id,
  };
};
