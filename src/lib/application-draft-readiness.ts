import type { ApplicationDraftReview } from '@/lib/validation/application-draft';

export type ClientReadinessIssue = {
  key: string;
  section: 'application' | 'project' | 'site' | 'client' | 'agent' | 'documents' | 'confirmations';
  label: string;
  message: string;
  legal?: boolean;
};

const missing = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const addMissing = (
  issues: ClientReadinessIssue[],
  section: ClientReadinessIssue['section'],
  key: string,
  label: string,
  value: unknown,
  message: string,
) => {
  if (missing(value)) issues.push({ key, section, label, message });
};

const buildingConfirmationKeys = [
  ['applicantIsOwner', 'Applicant ownership'], ['applicationIsStaged', 'Staged application'],
  ['intendedLifeFiveYearsOrLess', 'Intended building life'], ['fireAndRescueServiceEnforcingAuthority', 'Fire and Rescue enforcing authority'],
  ['listedBuildingOrConservationArea', 'Listed building or conservation area'], ['otherHistoricalImportance', 'Other historical importance'],
  ['scottishMinistersRelaxationDirection', 'Scottish Ministers relaxation direction'], ['dangerousBuildingNotice', 'Dangerous building notice'],
  ['approvedCertifierOfConstruction', 'Approved certifier of construction'], ['coveredBySTAS', 'Scottish Type Approval Scheme'],
  ['restrictPublicInspection', 'Public inspection restriction'],
] as const;

export const evaluateClientApplicationDraftReadiness = (review: ApplicationDraftReview): ClientReadinessIssue[] => {
  const issues: ClientReadinessIssue[] = [];
  const route = String(review.selectedApplicationType);
  const planning = route === 'HOUSEHOLDER_PLANNING' || route === 'PLANNING_APPLICATION';

  if (review.projectMode === 'existing') addMissing(issues, 'project', 'existingProjectId', 'Existing project', review.existingProjectId, 'Choose the existing project.');
  else addMissing(issues, 'project', 'project.name', 'Project name', review.project.name, 'Confirm a project name.');

  if (review.projectMode !== 'existing') {
    addMissing(issues, 'site', 'site.buildingNumber', 'Site building number', review.site.buildingNumber, 'Enter the site building number.');
    if (review.siteMode === 'existing') addMissing(issues, 'site', 'existingSiteId', 'Existing site', review.existingSiteId, 'Choose the matching site.');
    else {
      addMissing(issues, 'site', 'site.addressLine1', 'Site address', review.site.addressLine1, 'Confirm the site address.');
      addMissing(issues, 'site', 'site.townCity', 'Site town or city', review.site.townCity, 'Confirm the site town or city.');
      addMissing(issues, 'site', 'site.postcode', 'Site postcode', review.site.postcode, 'Confirm the site postcode.');
      addMissing(issues, 'site', 'site.localAuthority', 'Local authority', review.site.localAuthority, 'Confirm the local authority.');
    }
    if (review.clientMode === 'existing') addMissing(issues, 'client', 'existingClientId', 'Existing client', review.existingClientId, 'Choose the matching client.');
    else {
      addMissing(issues, 'client', 'client.displayName', 'Client name', review.client.displayName, 'Confirm the client or company name.');
      if (review.client.clientType === 'INDIVIDUAL') {
        addMissing(issues, 'client', 'client.title', 'Applicant title', review.client.title, 'Confirm the applicant title.');
        addMissing(issues, 'client', 'client.firstName', 'Applicant first name', review.client.firstName, 'Confirm the applicant first name.');
        addMissing(issues, 'client', 'client.lastName', 'Applicant last name', review.client.lastName, 'Confirm the applicant last name.');
      } else addMissing(issues, 'client', 'client.companyName', 'Company name', review.client.companyName, 'Confirm the applicant company name.');
      addMissing(issues, 'client', 'client.email', 'Applicant email', review.client.email, 'Confirm the applicant email.');
      addMissing(issues, 'client', 'client.buildingNumber', 'Applicant building number', review.client.buildingNumber, 'Enter the applicant building number.');
      addMissing(issues, 'client', 'client.addressLine1', 'Applicant address', review.client.addressLine1, 'Confirm the applicant address.');
      addMissing(issues, 'client', 'client.townCity', 'Applicant town or city', review.client.townCity, 'Confirm the applicant town or city.');
      addMissing(issues, 'client', 'client.postcode', 'Applicant postcode', review.client.postcode, 'Confirm the applicant postcode.');
    }
  }
  if (review.applicantDifferentFromClient) {
    addMissing(issues, 'client', 'applicant.displayName', 'Applicant name', review.applicant?.displayName, 'Confirm the separate applicant name.');
    addMissing(issues, 'client', 'applicant.email', 'Applicant email', review.applicant?.email, 'Confirm the separate applicant email.');
    addMissing(issues, 'client', 'applicant.buildingNumber', 'Applicant building number', review.applicant?.buildingNumber, 'Enter the applicant building number.');
  }
  for (const [key, label] of [['practiceName', 'Practice name'], ['firstName', 'Agent first name'], ['lastName', 'Agent last name'], ['email', 'Agent email'], ['buildingNumber', 'Agent building number'], ['addressLine1', 'Agent address'], ['townCity', 'Agent town or city'], ['postcode', 'Agent postcode']] as const) {
    addMissing(issues, 'agent', `agent.${key}`, label, review.agent[key], `Confirm the ${label.toLowerCase()}.`);
  }
  addMissing(issues, 'application', 'application.description', 'Description of work', review.application.description?.trim(), 'Enter a description of the proposed work.');
  if (route === 'BUILDING_WARRANT') {
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
    for (const [key, label] of buildingConfirmationKeys) if (typeof review.confirmations[key] !== 'boolean') issues.push({ key: `confirmations.${key}`, section: 'confirmations', label, message: 'Confirm Yes or No.', legal: true });
  }
  if (planning) {
    for (const [key, label] of [['soleOwner', 'Sole owner of all land'], ['agriculturalHolding', 'Agricultural holding']] as const) if (typeof review.confirmations[key] !== 'boolean') issues.push({ key: `confirmations.${key}`, section: 'confirmations', label, message: 'Confirm Yes or No.', legal: true });
    if (review.confirmations.newOrAlteredVehicleAccess === true) {
      addMissing(issues, 'confirmations', 'confirmations.currentParkingSpaces', 'Current parking spaces', review.confirmations.currentParkingSpaces, 'Enter the current number of parking spaces.');
      addMissing(issues, 'confirmations', 'confirmations.proposedParkingSpaces', 'Proposed parking spaces', review.confirmations.proposedParkingSpaces, 'Enter the proposed number of parking spaces.');
    }
  }
  const locationPlans = review.documents.filter((document) => String(document.documentType) === 'LOCATION_PLAN');
  if (locationPlans.length !== 1) issues.push({ key: 'documents.locationPlan', section: 'documents', label: 'Location Plan', message: locationPlans.length ? 'Keep exactly one current Location Plan.' : 'Choose one Location Plan.' });
  for (const document of review.documents) if (String(document.documentStatus) === 'IN_REVIEW' || String(document.documentStatus) === 'DRAFT') issues.push({ key: `documents.${document.id}`, section: 'documents', label: 'Document review', message: 'Review this document classification before creating the application.' });
  return [...new Map(issues.map((issue) => [issue.key, issue])).values()];
};
