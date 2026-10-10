export const extractedFixture = (filename) => {
  const fields = filename.includes('Location') ? {
    'site.buildingNumber': '147', 'site.addressLine1': 'High Street', 'site.townCity': 'Glasgow', 'site.postcode': 'G1 1AA', 'site.localAuthority': 'Glasgow City Council',
  } : filename.includes('Proposed') ? {
    'project.title': '147 High Street extension', 'project.typeOfWork': 'domestic_alteration_extension', 'application.descriptionOfWork': 'Construction of a single-storey rear extension',
  } : {
    'applicant.clientType': 'INDIVIDUAL', 'applicant.title': 'Ms', 'applicant.firstName': 'Anna', 'applicant.lastName': 'Campbell', 'applicant.email': 'anna@example.test', 'applicant.phone': '07483882299',
    'agent.practiceName': 'Fixture Architects', 'agent.firstName': 'Jane', 'agent.lastName': 'Architect', 'agent.email': 'agent@example.test', 'agent.phone': '07483882299', 'agent.addressLine1': '10 Office Street', 'agent.townCity': 'Glasgow', 'agent.postcode': 'G1 1AA',
  };
  return { categoryKey: filename.includes('Location') ? 'location_plan' : filename.includes('Proposed') ? 'proposed_plans' : 'supporting_documents', certainty: 'high', detectedTitle: filename.replace('.pdf', ''), drawingNumber: 'AP-101', revision: 'A', pageCount: 1, existingOrProposed: 'proposed', evidence: 'Synthetic document title and content', manualReviewRequired: false, warnings: [], mixedDocumentDetected: false,
    extractedFacts: Object.entries(fields).map(([fieldKey, value]) => ({ key: fieldKey, value, page: 1, evidence: `${fieldKey}: ${value}` })) };
};
