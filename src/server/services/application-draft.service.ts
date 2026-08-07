import { createHash } from 'node:crypto';
import {
  ApplicationDraftDocumentStatus,
  ApplicationDraftDocumentUploadStatus,
  ApplicationDraftStatus,
  ApplicationDraftType,
  DocumentSortSource,
  DocumentStatus,
  DocumentType,
  Prisma,
  type Client,
  type OrganisationDefaults,
  type Site,
} from '@prisma/client';
import { APPLICATION_UPLOAD_LIMITS } from '@/lib/application-upload-limits';
import { prisma } from '@/lib/db/prisma';
import type { TypeOfWorkKey } from '@/lib/projects/type-of-work';
import { deleteStoredDocument, readStoredDocumentBytes } from '@/lib/server/upload-storage';
import {
  applicationDraftReviewSchema,
  preparedApplicationDraftSchema,
  type ApplicationDraftReview,
  type PreparedApplicationDraft,
} from '@/lib/validation/application-draft';
import { documentFactSchema } from '@/lib/validation/document-intelligence';
import { HttpError } from '@/lib/utils/http';
import {
  analysisStatusForSuggestion,
  classificationAuditForSuggestion,
  classificationDetailsFromAudit,
  classifyProjectDocumentBatch,
  configuredDocumentAnalysisIdentity,
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
  DOCUMENT_ANALYSIS_SCHEMA_VERSION,
  DOCUMENT_ANALYSIS_VERSION,
} from '@/server/services/pdf-classification.service';
import {
  findApplicationDraftMatches,
  matchValuesFromPreparation,
} from '@/server/services/application-draft-matching.service';
import type { DocumentSortSuggestion } from '@/server/services/document-sorter.service';

export const APPLICATION_DRAFT_RETENTION_DAYS = APPLICATION_UPLOAD_LIMITS.unfinishedDraftRetentionDays;
export const MAX_APPLICATION_DRAFT_FILES = APPLICATION_UPLOAD_LIMITS.maxFiles;

type DraftWithDocuments = Prisma.ApplicationDraftGetPayload<{
  include: { documents: true };
}>;

type SynthesisDocument = DraftWithDocuments['documents'][number];
type Fact = {
  fieldKey: string;
  value: string | number | boolean;
  page?: number;
  evidence: string;
  certainty: 'high' | 'medium' | 'low';
  documentId: string;
  filename: string;
};

export type DraftReadinessIssue = {
  key: string;
  section: 'application' | 'project' | 'site' | 'client' | 'agent' | 'documents' | 'confirmations';
  label: string;
  message: string;
  legal?: boolean;
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const scalar = (value: unknown): string | number | boolean | null =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;

const normalizedValue = (value: string | number | boolean) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : String(value);

const certaintyRank = (value: Fact['certainty']) => value === 'high' ? 3 : value === 'medium' ? 2 : 1;

const factSources = (facts: Fact[]) => facts.map((fact) => ({
  documentId: fact.documentId,
  filename: fact.filename,
  ...(fact.page ? { page: fact.page } : {}),
  evidence: fact.evidence,
}));

const missingSuggestion = () => ({
  value: null,
  status: 'missing' as const,
  certainty: 'low' as const,
  sources: [],
});

const defaultSuggestion = (value: string | number | boolean | null) => value === null
  ? missingSuggestion()
  : {
      value,
      status: 'default' as const,
      certainty: 'high' as const,
      sources: [],
    };

const suggestionFromFacts = (
  facts: Fact[],
  fieldKey: string,
  fallback: string | number | boolean | null = null,
) => {
  const candidates = facts
    .filter((fact) => fact.fieldKey === fieldKey)
    .sort((left, right) => certaintyRank(right.certainty) - certaintyRank(left.certainty));
  if (!candidates.length) return defaultSuggestion(fallback);
  const distinct = new Set(candidates.map((candidate) => normalizedValue(candidate.value)));
  const selected = candidates[0];
  return {
    value: selected.value,
    status: distinct.size > 1 ? 'conflict' as const : 'suggested' as const,
    certainty: selected.certainty,
    sources: factSources(candidates),
    ...(distinct.size > 1 ? { currentValue: candidates[1]?.value ?? null } : {}),
  };
};

const customSuggestion = (
  value: string | number | boolean | null,
  sources: PreparedApplicationDraft['project'][string]['sources'] = [],
  certainty: 'high' | 'medium' | 'low' = 'medium',
) => value === null
  ? missingSuggestion()
  : { value, status: 'suggested' as const, certainty, sources };

const collectFacts = (documents: SynthesisDocument[]): Fact[] => {
  const facts: Fact[] = [];
  for (const document of documents) {
    const details = classificationDetailsFromAudit(document.analysisResult);
    for (const candidate of details?.extractedFacts ?? []) {
      const parsed = documentFactSchema.safeParse(candidate);
      if (!parsed.success) continue;
      facts.push({
        ...parsed.data,
        documentId: document.id,
        filename: document.originalFilename,
      });
    }
  }
  return facts;
};

const commonReference = (documents: SynthesisDocument[]) => {
  const counts = new Map<string, { count: number; document: SynthesisDocument }>();
  for (const document of documents) {
    const match = document.originalFilename.match(/\b([a-z]?\d{2,4}[-_]\d{2,4})\b/i);
    if (!match) continue;
    const value = match[1].replace('_', '-').toUpperCase();
    const existing = counts.get(value);
    counts.set(value, { count: (existing?.count ?? 0) + 1, document });
  }
  const best = [...counts.entries()].sort((left, right) => right[1].count - left[1].count)[0];
  if (!best || best[1].count < Math.min(2, documents.length)) return null;
  return {
    value: best[0],
    source: {
      documentId: best[1].document.id,
      filename: best[1].document.originalFilename,
      evidence: 'Repeated project reference in uploaded filenames',
    },
  };
};

const explicitTypeOfWork = (value: unknown): TypeOfWorkKey | null => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('demol')) return 'demolition';
  if (text.includes('convert') || text.includes('change of use')) return 'conversion_change_of_use';
  if (text.includes('new build')) return 'new_build';
  if (text.includes('alter') || text.includes('extension')) return 'domestic_alteration_extension';
  return null;
};

const inferApplicationType = (
  requested: ApplicationDraftType | null,
  notes: string | null,
  facts: Fact[],
  typeOfWork: TypeOfWorkKey | null,
) => {
  if (requested && requested !== ApplicationDraftType.AUTO) return requested;
  if (typeOfWork) return ApplicationDraftType.BUILDING_WARRANT;
  const context = [
    notes,
    ...facts
      .filter((fact) => fact.fieldKey === 'application.planningReference')
      .map((fact) => String(fact.value)),
  ].filter(Boolean).join(' ').toLowerCase();
  if (/building\s*warrant/.test(context)) return ApplicationDraftType.BUILDING_WARRANT;
  if (/householder|planning\s+application|planning\s+reference/.test(context)) {
    return ApplicationDraftType.HOUSEHOLDER_PLANNING;
  }
  return null;
};

const clientDisplayName = (client: {
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}, fallback?: string | null) =>
  client.companyName?.trim()
  || [client.firstName, client.lastName].filter(Boolean).join(' ').trim()
  || fallback?.trim()
  || null;

const suggestionString = (
  section: PreparedApplicationDraft['project'],
  key: string,
) => {
  const value = scalar(section[key]?.value);
  return value === null ? null : String(value);
};

const personFromPrepared = (section: PreparedApplicationDraft['client']) => {
  const companyName = suggestionString(section, 'companyName');
  const firstName = suggestionString(section, 'firstName');
  const lastName = suggestionString(section, 'lastName');
  return {
    clientType: companyName ? 'ORGANISATION' as const : 'INDIVIDUAL' as const,
    displayName: suggestionString(section, 'name') ?? clientDisplayName({ companyName, firstName, lastName }),
    title: suggestionString(section, 'title'),
    firstName,
    lastName,
    companyName,
    email: suggestionString(section, 'email'),
    phone: suggestionString(section, 'phone'),
    buildingNumber: suggestionString(section, 'buildingNumber'),
    addressLine1: suggestionString(section, 'addressLine1'),
    addressLine2: suggestionString(section, 'addressLine2'),
    townCity: suggestionString(section, 'townCity'),
    postcode: suggestionString(section, 'postcode'),
    country: suggestionString(section, 'country') ?? 'United Kingdom',
  };
};

const personFromClient = (client: Client) => ({
  clientType: client.companyName ? 'ORGANISATION' as const : 'INDIVIDUAL' as const,
  displayName: client.name,
  title: client.title,
  firstName: client.firstName,
  lastName: client.lastName,
  companyName: client.companyName,
  email: client.email,
  phone: client.phone,
  buildingNumber: client.buildingNumber,
  addressLine1: client.addressLine1 ?? client.address,
  addressLine2: client.addressLine2,
  townCity: client.townCity,
  postcode: client.postcode,
  country: client.country ?? 'United Kingdom',
});

const withDefaultIndividualTitle = (
  person: ApplicationDraftReview['client'],
): ApplicationDraftReview['client'] =>
  person.clientType === 'INDIVIDUAL' && !person.title?.trim()
    ? { ...person, title: 'Other' }
    : person;

const siteFromPrepared = (prepared: PreparedApplicationDraft) => ({
  addressLine1: suggestionString(prepared.site, 'addressLine1'),
  addressLine2: suggestionString(prepared.site, 'addressLine2'),
  townCity: suggestionString(prepared.site, 'townCity'),
  postcode: suggestionString(prepared.site, 'postcode'),
  country: suggestionString(prepared.site, 'country') ?? 'United Kingdom',
  localAuthority: suggestionString(prepared.site, 'localAuthority'),
});

const siteFromRecord = (site: Site) => ({
  addressLine1: site.addressLine1,
  addressLine2: site.addressLine2,
  townCity: site.townCity,
  postcode: site.postcode,
  country: 'United Kingdom',
  localAuthority: site.localAuthority,
});

const agentFromDefaults = (defaults: OrganisationDefaults | null) => ({
  practiceName: defaults?.practiceName ?? null,
  firstName: defaults?.agentFirstName ?? null,
  lastName: defaults?.agentLastName ?? null,
  email: defaults?.agentEmail ?? null,
  phone: defaults?.agentPhone ?? null,
  buildingNumber: defaults?.agentBuildingNumber ?? null,
  addressLine1: defaults?.agentAddressLine1 ?? null,
  addressLine2: defaults?.agentAddressLine2 ?? null,
  townCity: defaults?.agentTownCity ?? null,
  postcode: defaults?.agentPostcode ?? null,
  country: defaults?.agentCountry ?? 'United Kingdom',
  saveAsOrganisationDefault: false,
});

const formattedSiteProjectName = (...values: unknown[]) => values
  .map((value) => scalar(value))
  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  .map((value) => value.trim())
  .join(', ');

const defaultConfirmations = (type: ApplicationDraftType) => {
  if (type === ApplicationDraftType.HOUSEHOLDER_PLANNING || type === ApplicationDraftType.PLANNING_APPLICATION) {
    return {
      discussedWithPlanningAuthority: false,
      treesOnOrAdjacentToSite: false,
      newOrAlteredVehicleAccess: false,
      currentParkingSpaces: null,
      proposedParkingSpaces: null,
      soleOwner: true,
      agriculturalHolding: false,
    };
  }
  return {};
};

export const synthesisePreparedApplicationDraft = async (
  organisationId: string,
  draft: DraftWithDocuments,
) => {
  const defaults = await prisma.organisationDefaults.findUnique({ where: { organisationId } });
  const facts = collectFacts(draft.documents);
  const reference = commonReference(draft.documents);
  const siteAddress = suggestionFromFacts(facts, 'site.addressLine1');
  const siteAddressLine2 = suggestionFromFacts(facts, 'site.addressLine2');
  const siteTownCity = suggestionFromFacts(facts, 'site.townCity');
  const sitePostcode = suggestionFromFacts(facts, 'site.postcode');
  const projectTitle = suggestionFromFacts(facts, 'project.title');
  const fullSiteAddress = formattedSiteProjectName(
    siteAddress.value,
    siteAddressLine2.value,
    siteTownCity.value,
    sitePostcode.value,
  );
  const fallbackProjectName = fullSiteAddress
    ? customSuggestion(
        fullSiteAddress,
        [...siteAddress.sources, ...siteAddressLine2.sources, ...siteTownCity.sources, ...sitePostcode.sources],
        siteAddress.certainty,
      )
    : projectTitle;
  const rawTypeOfWork = suggestionFromFacts(facts, 'project.typeOfWork');
  const typeOfWork = explicitTypeOfWork(rawTypeOfWork.value)
    ?? explicitTypeOfWork(draft.notes);
  const suggestedApplicationType = inferApplicationType(draft.selectedApplicationType, draft.notes, facts, typeOfWork);

  const clientFields = {
    title: suggestionFromFacts(facts, 'applicant.title', 'Other'),
    firstName: suggestionFromFacts(facts, 'applicant.firstName'),
    lastName: suggestionFromFacts(facts, 'applicant.lastName'),
    companyName: suggestionFromFacts(facts, 'applicant.companyName'),
    email: suggestionFromFacts(facts, 'applicant.email'),
    phone: suggestionFromFacts(facts, 'applicant.phone'),
    addressLine1: suggestionFromFacts(facts, 'applicant.addressLine1'),
    addressLine2: suggestionFromFacts(facts, 'applicant.addressLine2'),
    townCity: suggestionFromFacts(facts, 'applicant.townCity'),
    postcode: suggestionFromFacts(facts, 'applicant.postcode'),
    country: suggestionFromFacts(facts, 'applicant.country', 'United Kingdom'),
  };
  const clientName = clientDisplayName({
    companyName: scalar(clientFields.companyName.value) as string | null,
    firstName: scalar(clientFields.firstName.value) as string | null,
    lastName: scalar(clientFields.lastName.value) as string | null,
  });

  const agent = {
    practiceName: defaultSuggestion(defaults?.practiceName ?? null),
    firstName: defaultSuggestion(defaults?.agentFirstName ?? null),
    lastName: defaultSuggestion(defaults?.agentLastName ?? null),
    email: defaultSuggestion(defaults?.agentEmail ?? null),
    phone: defaultSuggestion(defaults?.agentPhone ?? null),
    buildingNumber: defaultSuggestion(defaults?.agentBuildingNumber ?? null),
    addressLine1: defaultSuggestion(defaults?.agentAddressLine1 ?? null),
    addressLine2: defaultSuggestion(defaults?.agentAddressLine2 ?? null),
    townCity: defaultSuggestion(defaults?.agentTownCity ?? null),
    postcode: defaultSuggestion(defaults?.agentPostcode ?? null),
    country: defaultSuggestion(defaults?.agentCountry ?? 'United Kingdom'),
  };

  const classifications = draft.documents.map((document) => classificationDetailsFromAudit(document.analysisResult));
  const fallbackCount = draft.documents.filter((document) => document.analysisStatus === ApplicationDraftDocumentStatus.FALLBACK).length;
  const failedCount = draft.documents.filter((document) => document.analysisStatus === ApplicationDraftDocumentStatus.FAILED).length;
  const warnings = [
    ...new Set(classifications.flatMap((details) => details?.warnings ?? [])),
  ];
  if (facts.some((fact) => fact.fieldKey.startsWith('evidence.'))) {
    warnings.push('Possible legal or application declarations were found. They remain unanswered until you confirm them.');
  }

  const preparedWithoutMatches = preparedApplicationDraftSchema.parse({
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      name: fallbackProjectName,
      internalReference: reference
        ? customSuggestion(reference.value, [reference.source], 'medium')
        : missingSuggestion(),
      typeOfWorkKey: typeOfWork
        ? customSuggestion(
            typeOfWork,
            rawTypeOfWork.sources.length ? rawTypeOfWork.sources : [{
              documentId: 'project-notes',
              filename: 'Project notes',
              evidence: 'Type of work stated in the optional project notes',
            }],
            rawTypeOfWork.certainty,
          )
        : missingSuggestion(),
      summary: suggestionFromFacts(facts, 'application.descriptionOfWork'),
    },
    site: {
      addressLine1: siteAddress,
      addressLine2: siteAddressLine2,
      townCity: siteTownCity,
      postcode: sitePostcode,
      country: defaultSuggestion('United Kingdom'),
      localAuthority: suggestionFromFacts(facts, 'site.localAuthority'),
    },
    client: {
      name: clientName
        ? customSuggestion(clientName, [
            ...clientFields.companyName.sources,
            ...clientFields.firstName.sources,
            ...clientFields.lastName.sources,
          ], 'medium')
        : missingSuggestion(),
      ...clientFields,
    },
    agent,
    application: {
      route: suggestedApplicationType
        ? customSuggestion(suggestedApplicationType, [], draft.selectedApplicationType === ApplicationDraftType.AUTO ? 'medium' : 'high')
        : missingSuggestion(),
      description: suggestionFromFacts(facts, 'application.descriptionOfWork'),
      currentUse: suggestionFromFacts(facts, 'application.currentUse'),
      proposedUse: suggestionFromFacts(facts, 'application.proposedUse'),
      estimatedValue: suggestionFromFacts(facts, 'application.estimatedValue'),
      planningReference: suggestionFromFacts(facts, 'application.planningReference'),
      presetKey: typeOfWork ? customSuggestion(typeOfWork, rawTypeOfWork.sources, rawTypeOfWork.certainty) : missingSuggestion(),
    },
    matches: { clients: [], sites: [], projects: [] },
    summary: {
      documentCount: draft.documents.length,
      analysedCount: draft.documents.length - failedCount,
      fallbackCount,
      failedCount,
      preparedFieldCount: 0,
      attentionCount: 0,
    },
    warnings,
  });

  const matches = await findApplicationDraftMatches(
    organisationId,
    matchValuesFromPreparation(preparedWithoutMatches),
  );
  const preparedFields = [
    ...Object.values(preparedWithoutMatches.project),
    ...Object.values(preparedWithoutMatches.site),
    ...Object.values(preparedWithoutMatches.client),
    ...Object.values(preparedWithoutMatches.agent),
    ...Object.values(preparedWithoutMatches.application),
  ];
  const prepared = preparedApplicationDraftSchema.parse({
    ...preparedWithoutMatches,
    matches: {
      clients: matches.clients,
      sites: matches.sites,
      projects: matches.projects,
    },
    summary: {
      ...preparedWithoutMatches.summary,
      preparedFieldCount: preparedFields.filter((field) => field.value !== null && field.status !== 'missing').length,
      attentionCount:
        preparedFields.filter((field) => field.status === 'missing' || field.status === 'conflict').length
        + fallbackCount
        + failedCount,
    },
  });

  return { prepared, matches, defaults, suggestedApplicationType };
};

const buildInitialReview = (
  draft: DraftWithDocuments,
  prepared: PreparedApplicationDraft,
  matches: Awaited<ReturnType<typeof findApplicationDraftMatches>>,
  defaults: OrganisationDefaults | null,
  suggestedApplicationType: ApplicationDraftType | null,
): ApplicationDraftReview => {
  const strongClient = matches.strongClient;
  const strongSite = matches.strongSite;
  const requestedType = draft.selectedApplicationType && draft.selectedApplicationType !== ApplicationDraftType.AUTO
    ? draft.selectedApplicationType
    : suggestedApplicationType ?? ApplicationDraftType.AUTO;
  const client = withDefaultIndividualTitle(strongClient ? personFromClient(strongClient) : personFromPrepared(prepared.client));
  const site = strongSite ? siteFromRecord(strongSite) : siteFromPrepared(prepared);
  const clientAddressSameAsSite = Boolean(
    site.addressLine1
    && site.townCity
    && site.postcode
    && (!strongClient || [client.addressLine1, client.townCity, client.postcode].every((value) => !value)),
  );
  const clientWithDefaultAddress = clientAddressSameAsSite ? {
    ...client,
    addressLine1: site.addressLine1,
    addressLine2: site.addressLine2,
    townCity: site.townCity,
    postcode: site.postcode,
    country: site.country,
  } : client;
  const typeOfWork = explicitTypeOfWork(suggestionString(prepared.project, 'typeOfWorkKey'));
  const existingReview = applicationDraftReviewSchema.safeParse(draft.confirmedData);
  const currentDocuments = draft.documents.map((document) => {
    const details = classificationDetailsFromAudit(document.analysisResult);
    const acceptedByDefault =
      document.analysisStatus === ApplicationDraftDocumentStatus.SUCCESS
      && !details?.manualReviewRequired
      && (document.confidence ?? 0) >= 0.55;
    const previous = existingReview.success
      ? existingReview.data.documents.find((item) => item.id === document.id)
      : undefined;
    return previous ?? {
      id: document.id,
      documentType: document.documentType,
      documentStatus: acceptedByDefault ? DocumentStatus.APPROVED : DocumentStatus.IN_REVIEW,
      revision: document.revision,
      drawingNumber: document.drawingNumber,
      drawingTitle: document.drawingTitle,
    };
  });

  if (existingReview.success) {
    return {
      ...existingReview.data,
      client: withDefaultIndividualTitle(existingReview.data.client),
      applicant: withDefaultIndividualTitle(existingReview.data.applicant ?? existingReview.data.client),
      selectedApplicationType:
        existingReview.data.selectedApplicationType === ApplicationDraftType.AUTO && suggestedApplicationType
          ? suggestedApplicationType
          : existingReview.data.selectedApplicationType,
      documents: currentDocuments,
    };
  }

  return applicationDraftReviewSchema.parse({
    selectedApplicationType: requestedType,
    projectMode: 'create',
    existingProjectId: null,
    project: {
      name: suggestionString(prepared.project, 'name'),
      internalReference: suggestionString(prepared.project, 'internalReference'),
      typeOfWorkKey: typeOfWork,
      summary: suggestionString(prepared.project, 'summary'),
    },
    siteMode: strongSite ? 'existing' : 'create',
    existingSiteId: strongSite?.id ?? null,
    site,
    clientMode: strongClient ? 'existing' : 'create',
    existingClientId: strongClient?.id ?? null,
    client: clientWithDefaultAddress,
    clientAddressSameAsSite,
    applicantDifferentFromClient: false,
    applicant: client,
    agent: agentFromDefaults(defaults),
    application: {
      description: suggestionString(prepared.application, 'description'),
      currentUse: suggestionString(prepared.application, 'currentUse'),
      proposedUse: suggestionString(prepared.application, 'proposedUse'),
      estimatedValue: scalar(prepared.application.estimatedValue?.value),
      presetKey: typeOfWork,
      typeOfWorkKeys: typeOfWork ? [typeOfWork] : [],
      selectedCertifierPresetId: defaults?.defaultCertifierPresetId ?? null,
    },
    confirmations: defaultConfirmations(requestedType),
    documents: currentDocuments,
  });
};

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';
const addMissing = (
  issues: DraftReadinessIssue[],
  section: DraftReadinessIssue['section'],
  key: string,
  label: string,
  value: unknown,
  message: string,
) => {
  if (isBlank(value)) issues.push({ key, section, label, message });
};

const BUILDING_CONFIRMATIONS = [
  ['applicantIsOwner', 'Applicant ownership'],
  ['applicationIsStaged', 'Staged application'],
  ['intendedLifeFiveYearsOrLess', 'Intended building life'],
  ['fireAndRescueServiceEnforcingAuthority', 'Fire and Rescue enforcing authority'],
  ['listedBuildingOrConservationArea', 'Listed building or conservation area'],
  ['otherHistoricalImportance', 'Other historical importance'],
  ['scottishMinistersRelaxationDirection', 'Scottish Ministers relaxation direction'],
  ['dangerousBuildingNotice', 'Dangerous building notice'],
  ['approvedCertifierOfConstruction', 'Approved certifier of construction'],
  ['coveredBySTAS', 'Scottish Type Approval Scheme'],
  ['restrictPublicInspection', 'Public inspection restriction'],
] as const;

export const evaluateApplicationDraftReadiness = (review: ApplicationDraftReview): DraftReadinessIssue[] => {
  const issues: DraftReadinessIssue[] = [];
  if (review.projectMode === 'existing') {
    addMissing(issues, 'project', 'existingProjectId', 'Existing project', review.existingProjectId, 'Choose the existing project.');
  } else {
    addMissing(issues, 'project', 'project.name', 'Project name', review.project.name, 'Confirm a project name.');
  }

  if (review.projectMode !== 'existing') {
    if (review.siteMode === 'existing') {
      addMissing(issues, 'site', 'existingSiteId', 'Existing site', review.existingSiteId, 'Choose the matching site.');
    } else {
      addMissing(issues, 'site', 'site.addressLine1', 'Site address', review.site.addressLine1, 'Confirm the site address.');
      addMissing(issues, 'site', 'site.townCity', 'Site town or city', review.site.townCity, 'Confirm the site town or city.');
      addMissing(issues, 'site', 'site.postcode', 'Site postcode', review.site.postcode, 'Confirm the site postcode.');
      addMissing(issues, 'site', 'site.localAuthority', 'Local authority', review.site.localAuthority, 'Confirm the local authority.');
    }
    if (review.clientMode === 'existing') {
      addMissing(issues, 'client', 'existingClientId', 'Existing client', review.existingClientId, 'Choose the matching client.');
    } else {
      addMissing(issues, 'client', 'client.displayName', 'Client name', review.client.displayName, 'Confirm the client or company name.');
      if (review.client.clientType === 'INDIVIDUAL') {
        addMissing(issues, 'client', 'client.title', 'Applicant title', review.client.title, 'Confirm the applicant title.');
        addMissing(issues, 'client', 'client.firstName', 'Applicant first name', review.client.firstName, 'Confirm the applicant first name.');
        addMissing(issues, 'client', 'client.lastName', 'Applicant last name', review.client.lastName, 'Confirm the applicant last name.');
      } else {
        addMissing(issues, 'client', 'client.companyName', 'Company name', review.client.companyName, 'Confirm the applicant company name.');
      }
      addMissing(issues, 'client', 'client.email', 'Applicant email', review.client.email, 'Confirm the applicant email.');
      addMissing(issues, 'client', 'client.buildingNumber', 'Applicant building number', review.client.buildingNumber, 'Enter the applicant building number.');
      addMissing(issues, 'client', 'client.addressLine1', 'Applicant address', review.client.addressLine1, 'Confirm the applicant address.');
      addMissing(issues, 'client', 'client.townCity', 'Applicant town or city', review.client.townCity, 'Confirm the applicant town or city.');
      addMissing(issues, 'client', 'client.postcode', 'Applicant postcode', review.client.postcode, 'Confirm the applicant postcode.');
    }
  }

  if (review.applicantDifferentFromClient) {
    const applicant = review.applicant;
    addMissing(issues, 'client', 'applicant.displayName', 'Applicant name', applicant?.displayName, 'Confirm the separate applicant name.');
    addMissing(issues, 'client', 'applicant.email', 'Applicant email', applicant?.email, 'Confirm the separate applicant email.');
    addMissing(issues, 'client', 'applicant.buildingNumber', 'Applicant building number', applicant?.buildingNumber, 'Enter the applicant building number.');
  }

  addMissing(issues, 'agent', 'agent.practiceName', 'Practice name', review.agent.practiceName, 'Confirm the normal practice name.');
  addMissing(issues, 'agent', 'agent.firstName', 'Agent first name', review.agent.firstName, 'Confirm the agent first name.');
  addMissing(issues, 'agent', 'agent.lastName', 'Agent last name', review.agent.lastName, 'Confirm the agent last name.');
  addMissing(issues, 'agent', 'agent.email', 'Agent email', review.agent.email, 'Confirm the agent email.');
  addMissing(issues, 'agent', 'agent.buildingNumber', 'Agent building number', review.agent.buildingNumber, 'Enter the agent building number.');
  addMissing(issues, 'agent', 'agent.addressLine1', 'Agent address', review.agent.addressLine1, 'Confirm the agent address.');
  addMissing(issues, 'agent', 'agent.townCity', 'Agent town or city', review.agent.townCity, 'Confirm the agent town or city.');
  addMissing(issues, 'agent', 'agent.postcode', 'Agent postcode', review.agent.postcode, 'Confirm the agent postcode.');

  addMissing(
    issues,
    'application',
    'application.description',
    'Description of work',
    review.application.description && review.application.description.trim().length >= 12 ? review.application.description : null,
    'Enter a specific description of the proposed work.',
  );

  if (review.selectedApplicationType === ApplicationDraftType.BUILDING_WARRANT) {
    if (!review.application.typeOfWorkKeys.length && !review.project.typeOfWorkKey) {
      issues.push({
        key: 'application.typeOfWorkKeys',
        section: 'application',
        label: 'Type of work',
        message: 'Choose at least one Building Warrant type of work.',
      });
    }
    addMissing(issues, 'application', 'application.currentUse', 'Current use', review.application.currentUse, 'Confirm the current use.');
    addMissing(issues, 'application', 'application.proposedUse', 'Proposed use', review.application.proposedUse, 'Confirm the proposed use.');
    addMissing(issues, 'application', 'application.estimatedValue', 'Estimated value', review.application.estimatedValue, 'Enter the estimated value of work.');
    for (const [key, label] of BUILDING_CONFIRMATIONS) {
      if (typeof review.confirmations[key] !== 'boolean') {
        issues.push({
          key: `confirmations.${key}`,
          section: 'confirmations',
          label,
          message: 'Confirm Yes or No.',
          legal: true,
        });
      }
    }
  }

  if (
    review.selectedApplicationType === ApplicationDraftType.HOUSEHOLDER_PLANNING
    || review.selectedApplicationType === ApplicationDraftType.PLANNING_APPLICATION
  ) {
    for (const [key, label] of [
      ['soleOwner', 'Sole owner of all land'],
      ['agriculturalHolding', 'Agricultural holding'],
    ] as const) {
      if (typeof review.confirmations[key] !== 'boolean') {
        issues.push({
          key: `confirmations.${key}`,
          section: 'confirmations',
          label,
          message: 'Confirm Yes or No.',
          legal: true,
        });
      }
    }
    if (review.confirmations.newOrAlteredVehicleAccess === true) {
      addMissing(
        issues,
        'confirmations',
        'confirmations.currentParkingSpaces',
        'Current parking spaces',
        review.confirmations.currentParkingSpaces,
        'Enter the current number of parking spaces.',
      );
      addMissing(
        issues,
        'confirmations',
        'confirmations.proposedParkingSpaces',
        'Proposed parking spaces',
        review.confirmations.proposedParkingSpaces,
        'Enter the proposed number of parking spaces.',
      );
    }
  }

  const locationPlans = review.documents.filter((document) => document.documentType === DocumentType.LOCATION_PLAN);
  if (locationPlans.length !== 1) {
    issues.push({
      key: 'documents.locationPlan',
      section: 'documents',
      label: 'Location Plan',
      message: locationPlans.length ? 'Keep exactly one current Location Plan.' : 'Choose one Location Plan.',
    });
  }
  for (const document of review.documents) {
    if (document.documentStatus === DocumentStatus.IN_REVIEW || document.documentStatus === DocumentStatus.DRAFT) {
      issues.push({
        key: `documents.${document.id}`,
        section: 'documents',
        label: 'Document review',
        message: 'Review this document classification before creating the application.',
      });
    }
  }
  return issues;
};

const persistSuggestion = async (
  document: SynthesisDocument,
  suggestion: DocumentSortSuggestion,
  identity: ReturnType<typeof configuredDocumentAnalysisIdentity>,
) => {
  const audit = classificationAuditForSuggestion(suggestion);
  const aiStatus = analysisStatusForSuggestion(suggestion);
  const status = aiStatus === 'SUCCESS'
    ? ApplicationDraftDocumentStatus.SUCCESS
    : ApplicationDraftDocumentStatus.FALLBACK;
  await prisma.applicationDraftDocument.update({
    where: { id: document.id },
    data: {
      analysisStatus: status,
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisProvider: suggestion.classificationDetails?.provider ?? identity.provider,
      analysisModel: suggestion.classificationDetails?.model ?? identity.model,
      analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
      analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
      analysisResult: audit as Prisma.InputJsonValue,
      analysisError: suggestion.classificationDetails?.fallbackReason ?? null,
      documentType: suggestion.suggestedDocumentType,
      revision: suggestion.revision,
      drawingNumber: suggestion.drawingNumber,
      drawingTitle: suggestion.drawingTitle,
      classificationSource: suggestion.source,
      confidence: suggestion.confidence,
      classificationReason: suggestion.reason,
    },
  });
};

const copyCachedAnalysis = async (
  target: SynthesisDocument,
  cached: {
    analysisStatus: ApplicationDraftDocumentStatus;
    analysisVersion: string | null;
    analysisProvider: string | null;
    analysisModel: string | null;
    analysisPromptVersion: string | null;
    analysisSchemaVersion: string | null;
    analysisResult: Prisma.JsonValue | null;
    analysisError: string | null;
    documentType: DocumentType;
    documentStatus: DocumentStatus;
    revision: string | null;
    drawingNumber: string | null;
    drawingTitle: string | null;
    classificationSource: DocumentSortSource | null;
    confidence: number | null;
    classificationReason: string | null;
  },
) => prisma.applicationDraftDocument.update({
  where: { id: target.id },
  data: {
    analysisStatus: cached.analysisStatus,
    analysisVersion: cached.analysisVersion,
    analysisProvider: cached.analysisProvider,
    analysisModel: cached.analysisModel,
    analysisPromptVersion: cached.analysisPromptVersion,
    analysisSchemaVersion: cached.analysisSchemaVersion,
    analysisResult: cached.analysisResult === null ? Prisma.JsonNull : cached.analysisResult,
    analysisError: cached.analysisError,
    documentType: cached.documentType,
    documentStatus: cached.documentStatus,
    revision: cached.revision,
    drawingNumber: cached.drawingNumber,
    drawingTitle: cached.drawingTitle,
    classificationSource: cached.classificationSource,
    confidence: cached.confidence,
    classificationReason: cached.classificationReason,
  },
});

const refreshAnalysisProgress = async (draftId: string, total: number) => {
  const grouped = await prisma.applicationDraftDocument.groupBy({
    by: ['analysisStatus'],
    where: { draftId },
    _count: { _all: true },
  });
  const completed = grouped
    .filter((row) => (
      row.analysisStatus !== ApplicationDraftDocumentStatus.PENDING
      && row.analysisStatus !== ApplicationDraftDocumentStatus.ANALYSING
    ))
    .reduce((sum, row) => sum + row._count._all, 0);
  await prisma.applicationDraft.update({
    where: { id: draftId },
    data: {
      analysisSummary: {
        phase: 'document-analysis',
        completed,
        total,
        message: completed < total
          ? `Analysing ${Math.min(completed + 1, total)} of ${total} documents`
          : `Analysed ${total} document${total === 1 ? '' : 's'}`,
      },
    },
  });
};

export const getApplicationDraftForOrganisation = async (
  draftId: string,
  organisationId: string,
) => {
  const draft = await prisma.applicationDraft.findFirst({
    where: { id: draftId, organisationId },
    include: { documents: { orderBy: { createdAt: 'asc' } } },
  });
  if (!draft) throw new HttpError(404, 'Application draft not found.');
  return draft;
};

const assertDraftCanChange = (draft: DraftWithDocuments) => {
  if (draft.status === ApplicationDraftStatus.COMMITTED) throw new HttpError(409, 'This application has already been created.');
  if (draft.status === ApplicationDraftStatus.COMMITTING) throw new HttpError(409, 'This application is currently being created.');
  if (draft.status === ApplicationDraftStatus.CANCELLED) throw new HttpError(409, 'This application draft was cancelled.');
  if (draft.status === ApplicationDraftStatus.EXPIRED || draft.expiresAt <= new Date()) {
    throw new HttpError(410, 'This application draft has expired.');
  }
};

export const prepareApplicationDraft = async (draftId: string, organisationId: string) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  assertDraftCanChange(draft);
  const result = await synthesisePreparedApplicationDraft(organisationId, draft);
  const review = buildInitialReview(
    draft,
    result.prepared,
    result.matches,
    result.defaults,
    result.suggestedApplicationType,
  );
  const issues = evaluateApplicationDraftReadiness(review);
  await prisma.applicationDraft.update({
    where: { id: draft.id },
    data: {
      suggestedApplicationType: result.suggestedApplicationType,
      preparedData: result.prepared as Prisma.InputJsonValue,
      confirmedData: review as Prisma.InputJsonValue,
      unresolvedQuestions: issues as unknown as Prisma.InputJsonValue,
      status: issues.length ? ApplicationDraftStatus.NEEDS_REVIEW : ApplicationDraftStatus.READY_TO_CREATE,
      analysisSummary: {
        phase: 'prepared',
        completed: draft.documents.length,
        total: draft.documents.length,
        attentionCount: issues.length,
        message: issues.length
          ? `${issues.length} detail${issues.length === 1 ? '' : 's'} need attention`
          : 'Ready to create',
      },
    },
  });
  return { prepared: result.prepared, review, issues };
};

const currentAnalysisCanBeReused = (
  document: SynthesisDocument,
  identity: ReturnType<typeof configuredDocumentAnalysisIdentity>,
) =>
  (
    document.analysisStatus === ApplicationDraftDocumentStatus.SUCCESS
    || document.analysisStatus === ApplicationDraftDocumentStatus.FALLBACK
  )
  && document.analysisVersion === DOCUMENT_ANALYSIS_VERSION
  && document.analysisProvider === identity.provider
  && document.analysisModel === identity.model
  && document.analysisPromptVersion === DOCUMENT_ANALYSIS_PROMPT_VERSION
  && document.analysisSchemaVersion === DOCUMENT_ANALYSIS_SCHEMA_VERSION
  && document.analysisResult !== null;

export const analyseApplicationDraft = async (
  draftId: string,
  organisationId: string,
  options: { force?: boolean } = {},
) => {
  let draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  assertDraftCanChange(draft);
  if (!draft.documents.length) throw new HttpError(400, 'Upload at least one document before analysis.');
  if (draft.documents.some((document) => document.uploadStatus !== ApplicationDraftDocumentUploadStatus.READY)) {
    throw new HttpError(409, 'Finish uploading each document before analysis.');
  }
  const identity = configuredDocumentAnalysisIdentity();
  await prisma.applicationDraft.update({
    where: { id: draft.id },
    data: {
      status: ApplicationDraftStatus.ANALYSING,
      analysisSummary: {
        phase: 'document-analysis',
        completed: 0,
        total: draft.documents.length,
        message: `Analysing 1 of ${draft.documents.length} documents`,
      },
    },
  });

  const reusable = options.force
    ? []
    : draft.documents.filter((document) => currentAnalysisCanBeReused(document, identity));
  const reusableIds = new Set(reusable.map((document) => document.id));
  const pending = draft.documents.filter((document) => !reusableIds.has(document.id));

  for (const document of pending) {
    if (!document.sha256) continue;
    const cachedDraft = await prisma.applicationDraftDocument.findFirst({
      where: {
        id: { not: document.id },
        sha256: document.sha256,
        draft: { organisationId },
        analysisVersion: DOCUMENT_ANALYSIS_VERSION,
        analysisProvider: identity.provider,
        analysisModel: identity.model,
        analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
        analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        analysisStatus: {
          in: [ApplicationDraftDocumentStatus.SUCCESS, ApplicationDraftDocumentStatus.FALLBACK],
        },
        analysisResult: { not: Prisma.JsonNull },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (cachedDraft && !options.force) {
      await copyCachedAnalysis(document, cachedDraft);
      reusableIds.add(document.id);
      await refreshAnalysisProgress(draft.id, draft.documents.length);
      continue;
    }

    const cachedProject = options.force ? null : await prisma.projectDocument.findFirst({
      where: {
        organisationId,
        fileHash: document.sha256,
        analysisVersion: DOCUMENT_ANALYSIS_VERSION,
        analysisProvider: identity.provider,
        analysisModel: identity.model,
        analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
        analysisSchemaVersion: DOCUMENT_ANALYSIS_SCHEMA_VERSION,
        analysisStatus: 'SUCCESS',
        analysisResult: { not: Prisma.JsonNull },
      },
      orderBy: { analysedAt: 'desc' },
    });
    if (cachedProject) {
      await copyCachedAnalysis(document, {
        analysisStatus: ApplicationDraftDocumentStatus.SUCCESS,
        analysisVersion: cachedProject.analysisVersion,
        analysisProvider: cachedProject.analysisProvider,
        analysisModel: cachedProject.analysisModel,
        analysisPromptVersion: cachedProject.analysisPromptVersion,
        analysisSchemaVersion: cachedProject.analysisSchemaVersion,
        analysisResult: cachedProject.analysisResult,
        analysisError: null,
        documentType: cachedProject.type,
        documentStatus: DocumentStatus.IN_REVIEW,
        revision: cachedProject.revision,
        drawingNumber: cachedProject.drawingNumber,
        drawingTitle: cachedProject.drawingTitle,
        classificationSource: cachedProject.sortSource,
        confidence: cachedProject.sortConfidence,
        classificationReason: cachedProject.sortReason,
      });
      reusableIds.add(document.id);
      await refreshAnalysisProgress(draft.id, draft.documents.length);
    }
  }

  draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  const toAnalyse = draft.documents.filter((document) => !reusableIds.has(document.id));
  if (toAnalyse.length) {
    await prisma.applicationDraftDocument.updateMany({
      where: { id: { in: toAnalyse.map((document) => document.id) }, draftId: draft.id },
      data: { analysisStatus: ApplicationDraftDocumentStatus.ANALYSING, analysisError: null },
    });
    const readableInputs = await Promise.all(toAnalyse.map(async (document) => {
      try {
        const bytes = await readStoredDocumentBytes(document.storageKey);
        if (document.mimeType === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          await deleteStoredDocument(document.storageKey).catch(() => undefined);
          await prisma.applicationDraftDocument.update({
            where: { id: document.id },
            data: {
              uploadStatus: ApplicationDraftDocumentUploadStatus.FAILED,
              analysisStatus: ApplicationDraftDocumentStatus.FAILED,
              analysisError: 'This document is not a valid PDF. Upload it again.',
            },
          });
          await refreshAnalysisProgress(draft.id, draft.documents.length);
          return null;
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (document.clientSha256 && document.clientSha256.toLowerCase() !== sha256) {
          await deleteStoredDocument(document.storageKey).catch(() => undefined);
          await prisma.applicationDraftDocument.update({
            where: { id: document.id },
            data: {
              uploadStatus: ApplicationDraftDocumentUploadStatus.FAILED,
              analysisStatus: ApplicationDraftDocumentStatus.FAILED,
              analysisError: 'This document could not be verified. Upload it again.',
            },
          });
          await refreshAnalysisProgress(draft.id, draft.documents.length);
          return null;
        }
        await prisma.applicationDraftDocument.update({
          where: { id: document.id },
          data: { sha256 },
        });
        return {
          document: { ...document, sha256 },
          input: {
            documentId: document.id,
            filename: document.originalFilename,
            mimeType: document.mimeType,
            bytes,
          },
        };
      } catch {
        await prisma.applicationDraftDocument.update({
          where: { id: document.id },
          data: {
            analysisStatus: ApplicationDraftDocumentStatus.FAILED,
            analysisError: 'The document could not be read. Upload it again or classify it manually.',
            documentStatus: DocumentStatus.IN_REVIEW,
            classificationReason: 'Document analysis was unavailable.',
          },
        });
        await refreshAnalysisProgress(draft.id, draft.documents.length);
        return null;
      }
    }));
    const readable = readableInputs.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
    const inputs = readable.map((entry) => entry.input);
    const suggestions = await classifyProjectDocumentBatch(
      inputs,
      {
        applicationType:
          draft.selectedApplicationType && draft.selectedApplicationType !== ApplicationDraftType.AUTO
            ? draft.selectedApplicationType
            : undefined,
        projectNotes: draft.notes ?? undefined,
      },
      undefined,
      async (suggestion, index) => {
        await persistSuggestion(readable[index].document, suggestion, identity);
        await refreshAnalysisProgress(draft.id, draft.documents.length);
      },
    );
    for (const [index, suggestion] of suggestions.entries()) {
      await persistSuggestion(readable[index].document, suggestion, identity);
    }
  }

  return prepareApplicationDraft(draft.id, organisationId);
};

export const saveApplicationDraftReview = async (
  draftId: string,
  organisationId: string,
  review: ApplicationDraftReview,
) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  assertDraftCanChange(draft);
  const documentIds = new Set(draft.documents.map((document) => document.id));
  if (
    review.documents.length !== draft.documents.length
    || review.documents.some((document) => !documentIds.has(document.id))
  ) {
    throw new HttpError(400, 'Review every document in this application draft.');
  }
  const issues = evaluateApplicationDraftReadiness(review);
  await prisma.$transaction([
    ...review.documents.map((document) => prisma.applicationDraftDocument.updateMany({
      where: { id: document.id, draftId: draft.id },
      data: {
        documentType: document.documentType,
        documentStatus: document.documentStatus,
        revision: document.revision,
        drawingNumber: document.drawingNumber,
        drawingTitle: document.drawingTitle,
        classificationSource: draft.documents.find((candidate) => candidate.id === document.id)?.documentType === document.documentType
          ? undefined
          : DocumentSortSource.MANUAL,
      },
    })),
    prisma.applicationDraft.update({
      where: { id: draft.id },
      data: {
        selectedApplicationType: review.selectedApplicationType,
        confirmedData: review as Prisma.InputJsonValue,
        unresolvedQuestions: issues as unknown as Prisma.InputJsonValue,
        status: issues.length ? ApplicationDraftStatus.NEEDS_REVIEW : ApplicationDraftStatus.READY_TO_CREATE,
        analysisSummary: {
          phase: 'review',
          completed: draft.documents.length,
          total: draft.documents.length,
          attentionCount: issues.length,
          message: issues.length
            ? `${issues.length} detail${issues.length === 1 ? '' : 's'} need attention`
            : 'Ready to create',
        },
      },
    }),
  ]);
  return { review, issues };
};

export const applicationDraftAnalysisSummary = (value: unknown) => {
  const data = jsonObject(value);
  return {
    phase: typeof data.phase === 'string' ? data.phase : 'upload',
    completed: typeof data.completed === 'number' ? data.completed : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    message: typeof data.message === 'string' ? data.message : 'Waiting to analyse',
    attentionCount: typeof data.attentionCount === 'number' ? data.attentionCount : 0,
  };
};

export const parsedPreparedApplicationDraft = (value: unknown) =>
  preparedApplicationDraftSchema.safeParse(value).success
    ? preparedApplicationDraftSchema.parse(value)
    : null;

export const parsedApplicationDraftReview = (value: unknown) =>
  applicationDraftReviewSchema.safeParse(value).success
    ? applicationDraftReviewSchema.parse(value)
    : null;
