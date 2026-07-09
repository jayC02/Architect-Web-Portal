import { PlanningStatus, WarrantStatus } from '@prisma/client';

export type PlanningDateField = 'submissionDate' | 'validDate' | 'decisionTargetDate' | 'decisionDate';
export type WarrantDateField = 'submissionDate' | 'firstResponseTargetDate' | 'grantedDate' | 'expiryDate';

const planningFieldsByStatus: Record<PlanningStatus, PlanningDateField[]> = {
  [PlanningStatus.NOT_STARTED]: [],
  [PlanningStatus.DRAFTING]: [],
  [PlanningStatus.SUBMITTED]: ['submissionDate'],
  [PlanningStatus.VALIDATED]: ['submissionDate', 'validDate', 'decisionTargetDate'],
  [PlanningStatus.IN_REVIEW]: ['submissionDate', 'validDate', 'decisionTargetDate'],
  [PlanningStatus.FURTHER_INFORMATION_REQUESTED]: ['submissionDate', 'validDate', 'decisionTargetDate'],
  [PlanningStatus.APPROVED]: ['submissionDate', 'validDate', 'decisionDate'],
  [PlanningStatus.REFUSED]: ['submissionDate', 'validDate', 'decisionDate'],
  [PlanningStatus.WITHDRAWN]: [],
  [PlanningStatus.CLOSED]: [],
};

const warrantFieldsByStatus: Record<WarrantStatus, WarrantDateField[]> = {
  [WarrantStatus.NOT_STARTED]: [],
  [WarrantStatus.DRAFTING]: [],
  [WarrantStatus.SUBMITTED]: ['submissionDate', 'firstResponseTargetDate'],
  [WarrantStatus.IN_REVIEW]: ['submissionDate', 'firstResponseTargetDate'],
  [WarrantStatus.FURTHER_INFORMATION_REQUESTED]: ['submissionDate', 'firstResponseTargetDate'],
  [WarrantStatus.GRANTED]: ['submissionDate', 'grantedDate', 'expiryDate'],
  [WarrantStatus.REJECTED]: [],
  [WarrantStatus.EXPIRED]: ['grantedDate', 'expiryDate'],
  [WarrantStatus.COMPLETED]: ['grantedDate'],
  [WarrantStatus.CLOSED]: [],
};

export const planningDateFieldsForStatus = (status: PlanningStatus | string | null | undefined): PlanningDateField[] => {
  if (!status || !(status in planningFieldsByStatus)) return [];
  return planningFieldsByStatus[status as PlanningStatus];
};

export const warrantDateFieldsForStatus = (status: WarrantStatus | string | null | undefined): WarrantDateField[] => {
  if (!status || !(status in warrantFieldsByStatus)) return [];
  return warrantFieldsByStatus[status as WarrantStatus];
};

export const planningAdvancedHasValues = (record: Partial<Record<PlanningDateField | 'portalUrl', unknown>>) =>
  Boolean(record.portalUrl || record.validDate || record.decisionTargetDate || record.decisionDate);

export const warrantAdvancedHasValues = (record: Partial<Record<WarrantDateField | 'portalUrl' | 'completionCertificateStatus', unknown>>) =>
  Boolean(record.portalUrl || record.firstResponseTargetDate || record.grantedDate || record.expiryDate || record.completionCertificateStatus);