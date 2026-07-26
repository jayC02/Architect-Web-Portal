import { AutomationJobType, DocumentStatus, DocumentType } from '@prisma/client';

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
      address: { addressLine1: string | null; townCity: string | null; postcode: string | null };
    };
  };
  project: { typeOfWorkKey: string };
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
    description: string | null;
    answers: { soleOwner: boolean | null; agriculturalHolding: boolean | null };
  } | null;
  buildingWarrant: {
    description: string | null;
    estimatedValue: number | null;
    currentUse: string | null;
    proposedUse: string | null;
  } | null;
  documents: Array<{ categoryKey: DocumentType; reviewState: DocumentStatus }>;
};

const genericDescription = /^(building works?|proposed works?|householder application|planning application|test|n\/?a)$/i;
const meaningfulDescription = (value: string | null) =>
  Boolean(value && value.trim().length >= 12 && !genericDescription.test(value.trim()));

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
  requireValue('applicant.phone', snapshot.applicant.phone, 'Add the applicant phone number.');
  requireValue('applicant.address.addressLine1', snapshot.applicant.address.addressLine1, 'Add the applicant address.');
  requireValue('applicant.address.townCity', snapshot.applicant.address.townCity, 'Add the applicant town or city.');
  requireValue('applicant.address.postcode', snapshot.applicant.address.postcode, 'Add the applicant postcode.');

  const locationPlans = snapshot.documents.filter((document) => document.categoryKey === DocumentType.LOCATION_PLAN);
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
  }

  if (snapshot.metadata.applicationType === AutomationJobType.BUILDING_WARRANT) {
    if (!snapshot.buildingWarrant || !meaningfulDescription(snapshot.buildingWarrant.description)) {
      missing.push({
        code: 'missing_building_warrant_description',
        field: 'buildingWarrant.description',
        message: 'Enter a specific description of the Building Warrant work.',
        severity: 'error',
      });
    }
    requireValue('buildingWarrant.estimatedValue', snapshot.buildingWarrant?.estimatedValue, 'Enter the estimated value of work.');
    requireValue('buildingWarrant.currentUse', snapshot.buildingWarrant?.currentUse, 'Enter the current use of the building.');
    requireValue('buildingWarrant.proposedUse', snapshot.buildingWarrant?.proposedUse, 'Enter the proposed use of the building.');
  } else {
    if (!snapshot.planning || !meaningfulDescription(snapshot.planning.description)) {
      missing.push({
        code: 'missing_planning_description',
        field: 'planning.description',
        message: 'Enter a specific description of the proposed work.',
        severity: 'error',
      });
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
