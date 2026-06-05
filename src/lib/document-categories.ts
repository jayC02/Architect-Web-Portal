import { DocumentType } from '@prisma/client';

export const preferredDocumentTypes = [
  DocumentType.LOCATION_PLAN,
  DocumentType.PROPOSED_DRAWING,
  DocumentType.EXISTING_DRAWING,
  DocumentType.ELEVATION,
  DocumentType.SECTION,
  DocumentType.DETAILS,
  DocumentType.CALCULATIONS,
  DocumentType.SPECIFICATIONS,
  DocumentType.PHOTO,
  DocumentType.OTHER,
] satisfies DocumentType[];

export const documentTypeLabel = (type: DocumentType | string | null | undefined) => {
  switch (type) {
    case DocumentType.LOCATION_PLAN:
      return 'Location Plan';
    case DocumentType.PROPOSED_DRAWING:
      return 'Proposed Plans';
    case DocumentType.EXISTING_DRAWING:
      return 'Existing Plans';
    case DocumentType.ELEVATION:
      return 'Elevations';
    case DocumentType.SECTION:
      return 'Section';
    case DocumentType.DETAILS:
      return 'Details';
    case DocumentType.CALCULATIONS:
      return 'Calculations';
    case DocumentType.SPECIFICATIONS:
      return 'Specifications';
    case DocumentType.PHOTO:
      return 'Photos';
    case DocumentType.OTHER:
      return 'Other';
    default:
      return 'Other';
  }
};

export const documentGroupType = (type: DocumentType) => {
  switch (type) {
    case DocumentType.SITE_PLAN:
    case DocumentType.BLOCK_PLAN:
      return DocumentType.PROPOSED_DRAWING;
    case DocumentType.DRAINAGE:
    case DocumentType.CERTIFICATE:
    case DocumentType.CORRESPONDENCE:
      return DocumentType.OTHER;
    case DocumentType.STRUCTURAL:
    case DocumentType.ENERGY:
      return DocumentType.CALCULATIONS;
    case DocumentType.SUPPORTING_DOCUMENT:
      return DocumentType.SPECIFICATIONS;
    default:
      return preferredDocumentTypes.includes(type) ? type : DocumentType.OTHER;
  }
};
