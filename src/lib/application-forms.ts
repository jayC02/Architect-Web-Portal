// Every application form the project page offers, grouped by the portal it is submitted on.
// Adding a form: add its entry here, then its row content and pages.

export type ApplicationPortalKey = 'EPLANNING' | 'EBUILDING_STANDARDS';
export type ApplicationFormKey = 'PLANNING' | 'BUILDING_WARRANT' | 'COMPLETION_CERTIFICATE';

export const APPLICATION_PORTALS: Record<ApplicationPortalKey, { label: string; description: string; colour: string }> = {
  EPLANNING: { label: 'ePlanning', description: 'Planning authority', colour: '#185FA5' },
  EBUILDING_STANDARDS: { label: 'eBuilding Standards', description: 'Building standards', colour: '#A32D2D' },
};

export const APPLICATION_FORMS: readonly {
  key: ApplicationFormKey;
  portal: ApplicationPortalKey;
  label: string;
  description: string;
}[] = [
  { key: 'PLANNING', portal: 'EPLANNING', label: 'Planning', description: 'Householder or Planning Permission, chosen from the drawings' },
  { key: 'BUILDING_WARRANT', portal: 'EBUILDING_STANDARDS', label: 'Building Warrant', description: 'Building warrant application' },
  { key: 'COMPLETION_CERTIFICATE', portal: 'EBUILDING_STANDARDS', label: 'Completion Certificate', description: 'For the latest building warrant' },
];

export const formsForPortal = (portal: ApplicationPortalKey) => APPLICATION_FORMS.filter((form) => form.portal === portal);
