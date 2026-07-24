import { DocumentType } from '@prisma/client';

export const preferredDocumentTypes = [
  DocumentType.LOCATION_PLAN,
  DocumentType.SITE_PLAN,
  DocumentType.PROPOSED_DRAWING,
  DocumentType.EXISTING_DRAWING,
  DocumentType.ELEVATION,
  DocumentType.SECTION,
  DocumentType.DRAINAGE,
  DocumentType.DETAILS,
  DocumentType.CALCULATIONS,
  DocumentType.SPECIFICATIONS,
  DocumentType.PHOTO,
  DocumentType.SUPPORTING_DOCUMENT,
  DocumentType.OTHER,
] satisfies DocumentType[];

export const documentTypeLabel = (type: DocumentType | string | null | undefined) => {
  switch (type) {
    case DocumentType.LOCATION_PLAN:
      return 'Location Plan';
    case DocumentType.SITE_PLAN:
    case DocumentType.BLOCK_PLAN:
      return 'Site / Block Plan';
    case DocumentType.PROPOSED_DRAWING:
      return 'Proposed Plans';
    case DocumentType.EXISTING_DRAWING:
      return 'Existing Plans';
    case DocumentType.ELEVATION:
      return 'Elevations';
    case DocumentType.SECTION:
      return 'Section';
    case DocumentType.DETAILS:
      return 'Construction Details';
    case DocumentType.DRAINAGE:
      return 'Drainage';
    case DocumentType.CALCULATIONS:
      return 'Calculations';
    case DocumentType.SPECIFICATIONS:
      return 'Specifications';
    case DocumentType.PHOTO:
      return 'Photographs';
    case DocumentType.SUPPORTING_DOCUMENT:
      return 'Supporting Documents';
    case DocumentType.OTHER:
      return 'Other';
    default:
      return 'Other';
  }
};

export const documentGroupType = (type: DocumentType) => {
  switch (type) {
    case DocumentType.BLOCK_PLAN:
      return DocumentType.SITE_PLAN;
    case DocumentType.CERTIFICATE:
    case DocumentType.CORRESPONDENCE:
      return DocumentType.OTHER;
    case DocumentType.STRUCTURAL:
    case DocumentType.ENERGY:
      return DocumentType.CALCULATIONS;
    default:
      return preferredDocumentTypes.includes(type) ? type : DocumentType.OTHER;
  }
};
