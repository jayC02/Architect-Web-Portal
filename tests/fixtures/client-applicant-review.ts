import type { ApplicationDraftResponse } from '../../src/server/services/application-draft-view.service';
import type { ReviewClient } from '../../src/lib/clients/application-review';

export const savedClient: ReviewClient = {
  id: 'saved-laura', name: 'Laura MacDonald', title: 'Ms', firstName: 'Laura', lastName: 'MacDonald', companyName: null,
  email: 'laura@example.test', phone: null, buildingNumber: '24', addressLine1: 'Victoria Crescent Road', addressLine2: null,
  townCity: 'Glasgow', postcode: 'G12 9DD', country: 'United Kingdom',
};

export const clientReviewFixture = (): ApplicationDraftResponse => {
  const { id: _id, name, ...personFields } = savedClient;
  const person = { ...personFields, displayName: name, clientType: 'INDIVIDUAL' as const };
  return {
    id: 'concept-a-review', status: 'NEEDS_REVIEW', notes: null, suggestedApplicationType: 'HOUSEHOLDER_PLANNING',
    selectedApplicationType: 'HOUSEHOLDER_PLANNING', prepared: null, issues: [],
    analysis: { phase: 'complete', total: 1, completed: 1, attentionCount: 0, message: 'Prepared' },
    expiresAt: '2027-01-01T00:00:00Z', committedAt: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', result: null,
    review: {
      selectedApplicationType: 'HOUSEHOLDER_PLANNING', projectMode: 'create', existingProjectId: null,
      project: { name: '24 Victoria Crescent Road', internalReference: null, typeOfWorkKey: null, summary: null },
      siteMode: 'create', existingSiteId: null,
      site: { buildingNumber: '24', addressLine1: 'Victoria Crescent Road', addressLine2: null, townCity: 'Glasgow', postcode: 'G12 9DD', country: 'United Kingdom', localAuthority: 'Glasgow City Council' },
      clientMode: 'create', existingClientId: null, client: person, clientAddressSameAsSite: false,
      applicantDifferentFromClient: false, applicant: { ...person },
      agent: { practiceName: 'Example Architecture', firstName: 'Alex', lastName: 'Reid', email: 'alex@example.test', phone: null,
        buildingNumber: '8', addressLine1: 'Park Circus', addressLine2: null, townCity: 'Glasgow', postcode: 'G3 6AX', country: 'United Kingdom', saveAsOrganisationDefault: false },
      application: { description: 'Single-storey rear extension.', currentUse: null, proposedUse: null, estimatedValue: null, presetKey: null, typeOfWorkKeys: [], selectedCertifierPresetId: null },
      confirmations: { applicationFee: 325.5, soleOwner: true, agriculturalHolding: false },
      documents: [{ id: 'location-plan', documentType: 'LOCATION_PLAN', documentStatus: 'APPROVED', revision: null, drawingNumber: null, drawingTitle: null }],
    },
    documents: [{ id: 'location-plan', originalFilename: 'Proposed plans.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
      uploadStatus: 'READY', finalisedAt: '2026-10-14T00:00:00Z', uploadError: null, analysisStatus: 'SUCCESS', documentType: 'LOCATION_PLAN', documentStatus: 'APPROVED',
      revision: null, drawingNumber: null, drawingTitle: null, classificationSource: 'AI', classificationReason: null, needsManualReview: false, previewUrl: '/fixture.pdf' }],
  } as ApplicationDraftResponse;
};
