import { CONVERSION_KEYS, constructionCertificateSchema, permitsSTAS } from '@/lib/building-warrant-branches';
import type { z } from 'zod';
import { missingOwnerDetails, type WarrantOwnerDetails } from '@/lib/building-warrant-owner';
import { missingSustainabilityAnswers, type WarrantSustainability } from '@/lib/building-warrant-follow-ups';
import { AutomationJobType, DocumentStatus, DocumentType } from '@prisma/client';
import { resolveLocationPlans } from '@/lib/location-plan';

type Issue = {
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

type SnapshotInput = {
  metadata: { applicationType: AutomationJobType };
  organisation: {
    agent: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      buildingNumber: string | null;
      address: { addressLine1: string | null; townCity: string | null; postcode: string | null };
    };
  };
  project: { typeOfWorkKey: string; buildingUse?: 'residential' | 'commercial' | null; typeOfWorkKeys?: string[] };
  site: {
    address: { addressLine1: string | null; townCity: string | null; postcode: string | null };
    localAuthority: string | null;
  };
  applicant: {
    title: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    address: { addressLine1: string | null; townCity: string | null; postcode: string | null };
  };
  planning: {
    feeMinorUnits?: number | null;
    description: string | null;
    answers: { soleOwner: boolean | null; agriculturalHolding: boolean | null };
  } | null;
  buildingWarrant: {
    typeOfWorkKeys?: string[];
    conversionDescriptions?: string[];
    demolitionWeeks?: number | null;
    listingCategory?: string | null;
    stasReference?: string | null;
    constructionCertificate?: z.infer<typeof constructionCertificateSchema> | null;
    designCertificateWithApplication?: boolean;
    designCertificateFollowingApplication?: boolean;
    ownerIsClient?: boolean | null;
    owner?: WarrantOwnerDetails | null;
    fireAuthorityName?: string | null;
    historicalBuildingDetails?: string | null;
    dangerousBuildingReferences?: string | null;
    relaxationDirections?: Array<{ reference: string; date: string }>;
    relaxationReference?: string | null;
    relaxationDate?: string | null;
    sustainability?: WarrantSustainability;
    unusualAnswers?: Record<string, boolean | undefined>;
    description: string | null;
    estimatedValue: number | null;
    currentUse: string | null;
    proposedUse: string | null;
    certifier: {
      registrationAPart1: string | null;
      registrationAPart2: string | null;
      certifierName: string | null;
      registrationBPart1: string | null;
      registrationBPart2: string | null;
      approvedBody: string | null;
    } | null;
    feeCalculation?: {
      calculationStatus: 'CALCULATED' | 'NEEDS_INFORMATION';
      missingInputs?: string[];
      explanation: string[];
    };
  } | null;
  documents: Array<{ categoryKey: DocumentType; reviewState: DocumentStatus }>;
};

const meaningfulDescription = (value: string | null) =>
  Boolean(value?.trim());

export const evaluateAutomationPreflight = (snapshot: SnapshotInput) => {
  const missing: Issue[] = [];
  const warnings: Issue[] = [];
  const requireValue = (field: string, value: unknown, message: string) => {
    if (value === null || value === undefined || String(value).trim() === '') {
      missing.push({ code: `missing_${field.replaceAll('.', '_')}`, field, message, severity: 'error' });
    }
  };

  requireValue('organisation.agent.firstName', snapshot.organisation.agent.firstName, 'Add the normal agent first name in Organisation settings.');
  requireValue('organisation.agent.lastName', snapshot.organisation.agent.lastName, 'Add the normal agent last name in Organisation settings.');
  requireValue('organisation.agent.email', snapshot.organisation.agent.email, 'Add the normal agent email in Organisation settings.');
  requireValue('organisation.agent.buildingNumber', snapshot.organisation.agent.buildingNumber, 'Add the required agent building number.');
  requireValue('organisation.agent.address.addressLine1', snapshot.organisation.agent.address.addressLine1, 'Add the agent address in Organisation settings.');
  requireValue('organisation.agent.address.townCity', snapshot.organisation.agent.address.townCity, 'Add the agent town or city in Organisation settings.');
  requireValue('organisation.agent.address.postcode', snapshot.organisation.agent.address.postcode, 'Add the agent postcode in Organisation settings.');

  requireValue('site.address.addressLine1', snapshot.site.address.addressLine1, 'Link a site with a complete address.');
  requireValue('site.address.townCity', snapshot.site.address.townCity, 'Add the site town or city.');
  requireValue('site.address.postcode', snapshot.site.address.postcode, 'Add the site postcode.');
  requireValue('site.localAuthority', snapshot.site.localAuthority, 'Add the local authority to the linked site.');

  requireValue('applicant.title', snapshot.applicant.title, 'Confirm the applicant title.');
  requireValue('applicant.firstName', snapshot.applicant.firstName, 'Confirm the applicant first name.');
  requireValue('applicant.lastName', snapshot.applicant.lastName, 'Confirm the applicant last name.');
  requireValue('applicant.email', snapshot.applicant.email, 'Add the applicant email address.');
  requireValue('applicant.address.addressLine1', snapshot.applicant.address.addressLine1, 'Add the applicant address.');
  requireValue('applicant.address.townCity', snapshot.applicant.address.townCity, 'Add the applicant town or city.');
  requireValue('applicant.address.postcode', snapshot.applicant.address.postcode, 'Add the applicant postcode.');

  const locationPlans = resolveLocationPlans(snapshot.documents, (document) => document.categoryKey);
  const locationPlanStatus = locationPlans.some((document) => document.reviewState !== DocumentStatus.DRAFT)
    ? 'REVIEWED'
    : locationPlans.length
      ? 'PRESENT_UNREVIEWED'
      : 'MISSING';
  if (locationPlanStatus === 'MISSING') {
    missing.push({
      code: 'missing_location_plan',
      field: 'documents.locationPlan',
      message: 'Upload and review one Location Plan.',
      severity: 'error',
    });
  } else if (locationPlanStatus === 'PRESENT_UNREVIEWED') {
    warnings.push({
      code: 'unreviewed_location_plan',
      field: 'documents.locationPlan',
      message: 'Confirm which uploaded document is the Location Plan.',
      severity: 'warning',
    });
  } else if (locationPlans.length > 1) {
    missing.push({
      code: 'multiple_location_plans',
      field: 'documents.locationPlan',
      message: 'Choose one current Location Plan and reclassify the others.',
      severity: 'error',
    });
  }

  if (snapshot.metadata.applicationType === AutomationJobType.BUILDING_WARRANT) {
    if (!snapshot.buildingWarrant || !meaningfulDescription(snapshot.buildingWarrant.description)) {
      missing.push({
        code: 'missing_building_warrant_description',
        field: 'buildingWarrant.description',
        message: 'Enter a description of the Building Warrant work.',
        severity: 'error',
      });
    }
    if (typeof snapshot.buildingWarrant?.estimatedValue !== 'number' || !Number.isFinite(snapshot.buildingWarrant.estimatedValue) || snapshot.buildingWarrant.estimatedValue <= 0) missing.push({ code: 'missing_buildingWarrant_estimatedValue', field: 'buildingWarrant.estimatedValue', message: 'Enter an estimated value of work greater than zero.', severity: 'error' });
    const workTypes = snapshot.buildingWarrant?.typeOfWorkKeys ?? [snapshot.project.typeOfWorkKey];
    if (!snapshot.project.buildingUse) missing.push({ code: 'missing_project_building_use', field: 'project.buildingUse', message: 'Complete the project screening: choose Residential or Commercial.', severity: 'error' });
    if (snapshot.project.typeOfWorkKeys && !snapshot.project.typeOfWorkKeys.length) missing.push({ code: 'missing_project_work_types', field: 'project.typeOfWorkKeys', message: 'Complete the project screening: select at least one type of work.', severity: 'error' });
    if (workTypes.some(key => key === 'domestic_alteration_extension' || key === 'conversion_change_of_use')) {
      requireValue('buildingWarrant.currentUse', snapshot.buildingWarrant?.currentUse, 'Enter the current use of the building.');
      requireValue('buildingWarrant.proposedUse', snapshot.buildingWarrant?.proposedUse, 'Enter the proposed use of the building.');
    }
    if (workTypes.includes('conversion_change_of_use')) {
      const descriptions = snapshot.buildingWarrant?.conversionDescriptions;
      if (!descriptions?.length || descriptions.some(value => !CONVERSION_KEYS.includes(value as typeof CONVERSION_KEYS[number]))) missing.push({ code: 'missing_conversion_descriptions', field: 'buildingWarrant.conversionDescriptions', message: 'Select at least one applicable conversion description.', severity: 'error' });
    }
    if (workTypes.includes('demolition')) {
      const weeks = snapshot.buildingWarrant?.demolitionWeeks;
      if (!Number.isInteger(weeks) || weeks! < 1 || weeks! > 99) missing.push({ code: 'missing_demolition_weeks', field: 'buildingWarrant.demolitionWeeks', message: 'Enter a demolition period in whole weeks from 1 to 99.', severity: 'error' });
    }
    const answers = snapshot.buildingWarrant?.unusualAnswers;
    if (answers?.applicantIsOwner === false) {
      if (typeof snapshot.buildingWarrant?.ownerIsClient !== 'boolean') requireValue('buildingWarrant.ownerIsClient', null, 'Confirm whether the property owner is the saved client.');
      for (const issue of missingOwnerDetails(snapshot.buildingWarrant?.owner)) missing.push({ ...issue, code: `missing_${issue.field.replaceAll('.', '_')}`, severity: 'error' });
    }
    if (answers?.fireAndRescueServiceEnforcingAuthority === false) {
      requireValue('buildingWarrant.fireAuthorityName', snapshot.buildingWarrant?.fireAuthorityName, 'Enter the fire-authority name (maximum 20 characters).');
    }
    if (answers?.otherHistoricalImportance) requireValue('buildingWarrant.historicalBuildingDetails', snapshot.buildingWarrant?.historicalBuildingDetails, 'Enter the historical-importance details (maximum 750 characters).');
    if (answers?.dangerousBuildingNotice) requireValue('buildingWarrant.dangerousBuildingReferences', snapshot.buildingWarrant?.dangerousBuildingReferences, 'Enter the dangerous-building notice references (maximum 750 characters).');
    if (answers?.scottishMinistersRelaxationDirection) {
      const directions = snapshot.buildingWarrant?.relaxationDirections;
      if (directions?.length) directions.forEach((row, index) => {
        requireValue(`buildingWarrant.relaxationDirections.${index}.reference`, row.reference, `Enter the reference for relaxation direction ${index + 1}.`);
        requireValue(`buildingWarrant.relaxationDirections.${index}.date`, row.date, `Enter the date for relaxation direction ${index + 1}.`);
      });
      else {
        requireValue('buildingWarrant.relaxationReference', snapshot.buildingWarrant?.relaxationReference, 'Enter the Scottish Ministers relaxation-direction reference.');
        requireValue('buildingWarrant.relaxationDate', snapshot.buildingWarrant?.relaxationDate, 'Enter the relaxation-direction date.');
      }
    }
    if (workTypes.includes('new_build')) {
      for (const issue of missingSustainabilityAnswers(snapshot.buildingWarrant?.sustainability)) {
        missing.push({ ...issue, code: `missing_${issue.field.replaceAll('.', '_')}`, severity: 'error' });
      }
    }
    // Old frozen jobs with a different work-started answer need a fresh fee and snapshot.
    if (answers?.workStartedBeforeApplication === true) missing.push({
      code: 'outdated_warrant_work_started', field: 'buildingWarrant.unusualAnswers.workStartedBeforeApplication',
      message: 'Prepare this warrant again to apply the fixed work-started answer and recalculate its fee.', severity: 'error',
    });
    for (const key of ['applicationIsStaged', 'intendedLifeFiveYearsOrLess', 'restrictPublicInspection']) {
      if (answers?.[key]) missing.push({ code: 'outdated_warrant_policy', field: `buildingWarrant.unusualAnswers.${key}`, message: 'Prepare this warrant again to apply the supported project screening answers.', severity: 'error' });
    }
    if (answers?.listedBuildingOrConservationArea) requireValue('buildingWarrant.listingCategory', snapshot.buildingWarrant?.listingCategory, 'Enter the listing category or conservation-area details (maximum 750 characters).');
    if (answers?.coveredBySTAS) {
      if (!permitsSTAS(snapshot.project.buildingUse, workTypes)) missing.push({ code: 'outdated_stas_answer', field: 'buildingWarrant.unusualAnswers.coveredBySTAS', message: 'Prepare this residential warrant again to apply the project screening answers.', severity: 'error' });
      else requireValue('buildingWarrant.stasReference', snapshot.buildingWarrant?.stasReference, 'Enter the STAS approval reference (maximum 20 characters).');
    }
    if (answers?.approvedCertifierOfConstruction) {
      for (const field of ['schemeType', 'certifierName', 'registrationNumber', 'approvedBody', 'approvedBodyRegistrationNumber'] as const) requireValue(`buildingWarrant.constructionCertificate.${field}`, snapshot.buildingWarrant?.constructionCertificate?.[field], `Complete the construction certificate ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
      if (typeof answers.certifierOfConstructionCertificateAvailable !== 'boolean') requireValue('buildingWarrant.unusualAnswers.certifierOfConstructionCertificateAvailable', null, 'Confirm whether the construction certificate is available.');
    }
    if (answers?.declarationAuthorised !== true) missing.push({ code: 'missing_declaration_authorisation', field: 'buildingWarrant.unusualAnswers.declarationAuthorised', message: 'Review the application information and authorise the Agent to complete the declaration for final review.', severity: 'error' });
    if (answers?.certifierOfDesignCertificateAvailable === true) {
      const withApplication = snapshot.buildingWarrant?.designCertificateWithApplication;
      const followingApplication = snapshot.buildingWarrant?.designCertificateFollowingApplication;
      if (typeof withApplication !== 'boolean' || typeof followingApplication !== 'boolean' || withApplication === followingApplication) missing.push({ code: 'missing_design_certificate_timing', field: 'buildingWarrant.designCertificateWithApplication', message: 'Choose whether the design certificate will accompany this application or follow it.', severity: 'error' });
    }
    if (answers?.designCertifierSelected === true || answers?.certifierOfDesignCertificateAvailable === true) {
      requireValue('buildingWarrant.certifier.registrationAPart1', snapshot.buildingWarrant?.certifier?.registrationAPart1, 'Choose Registration number A Part 1.');
      requireValue('buildingWarrant.certifier.registrationAPart2', snapshot.buildingWarrant?.certifier?.registrationAPart2, 'Enter Registration number A Part 2.');
      requireValue('buildingWarrant.certifier.certifierName', snapshot.buildingWarrant?.certifier?.certifierName, 'Enter the name of the certifier.');
      requireValue('buildingWarrant.certifier.registrationBPart1', snapshot.buildingWarrant?.certifier?.registrationBPart1, 'Choose Registration number B Part 1.');
      requireValue('buildingWarrant.certifier.registrationBPart2', snapshot.buildingWarrant?.certifier?.registrationBPart2, 'Enter Registration number B Part 2.');
      requireValue('buildingWarrant.certifier.approvedBody', snapshot.buildingWarrant?.certifier?.approvedBody, 'Enter the name of the approved body.');
    }
    if (snapshot.buildingWarrant?.feeCalculation?.calculationStatus !== 'CALCULATED') {
      missing.push({
        code: 'missing_building_warrant_fee',
        field: 'buildingWarrant.feeCalculation',
        message: snapshot.buildingWarrant?.feeCalculation?.explanation[0]
          ?? 'Complete the Building Standards fee inputs.',
        severity: 'error',
      });
    }
  } else {
    if (!snapshot.planning || !meaningfulDescription(snapshot.planning.description)) {
      missing.push({
        code: 'missing_planning_description',
        field: 'planning.description',
        message: 'Enter a description of the proposed work.',
        severity: 'error',
      });
    }
    if (snapshot.planning?.feeMinorUnits == null) {
      missing.push({ code: 'missing_planning_fee', field: 'planning.feeMinorUnits', message: 'Enter the planning application fee in pounds.', severity: 'error' });
    }
    if (snapshot.planning?.answers.soleOwner === null) {
      missing.push({
        code: 'unconfirmed_sole_owner',
        field: 'planning.answers.soleOwner',
        message: 'Confirm whether the applicant is the sole owner of all land.',
        severity: 'error',
      });
    }
    if (snapshot.planning?.answers.agriculturalHolding === null) {
      missing.push({
        code: 'unconfirmed_agricultural_holding',
        field: 'planning.answers.agriculturalHolding',
        message: 'Confirm whether any land is part of an agricultural holding.',
        severity: 'error',
      });
    }
  }

  return {
    status: missing.length ? 'NEEDS_INPUT' as const : 'READY' as const,
    missing,
    warnings,
    locationPlanStatus,
    reviewedAt: null,
  };
};
