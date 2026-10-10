import { AutomationJobType } from '@prisma/client';
import { buildAutomationJobSnapshot } from './automation-jobs.service';
export type ReadinessItem = { label: string; state: 'Complete' | 'Optional' | 'Processing' | 'Retrying' | 'Needs review' | 'Blocked'; href: string; detail: string; blocking: boolean };
/** Uses the same fresh snapshot/preflight builder as queue authorisation. */
export async function loadProjectReadiness(input: { organisationId: string; organisationName: string; projectId: string; createdBy: { id: string; name: string; email: string }; planningApplicationId?: string; buildingWarrantApplicationId?: string; processing: Array<{ state: string }>; clientLinked?: boolean; siteLinked?: boolean }): Promise<ReadinessItem[]> {
  const href = `/projects/${input.projectId}`;
  const applicationHref = input.buildingWarrantApplicationId ? `/building-warrant/${input.buildingWarrantApplicationId}` : input.planningApplicationId ? `/planning/${input.planningApplicationId}` : `${href}#applications`;
  const hasApplication = Boolean(input.planningApplicationId || input.buildingWarrantApplicationId);
  const snapshot = await buildAutomationJobSnapshot({ ...input, type: input.buildingWarrantApplicationId ? AutomationJobType.BUILDING_WARRANT : AutomationJobType.HOUSEHOLDER_PLANNING });
  const issues = snapshot.preflight.missing;
  const group = (label: string, prefix: string, target: string): ReadinessItem => {
    const missing = issues.filter(issue => issue.field.startsWith(prefix));
    return { label, state: missing.length ? hasApplication ? 'Blocked' : 'Needs review' : 'Complete', blocking: hasApplication && missing.length > 0, href: target, detail: missing.length ? missing.map(issue => issue.message).join(' ') : 'Required details are present.' };
  };
  const documents = group('Documents', 'documents', `${href}#documents`);
  if (input.processing.some(job => ['RETRY', 'RETRYING'].includes(job.state))) { documents.state = 'Retrying'; documents.detail = 'Document analysis will retry; completed transfers are kept.'; }
  else if (input.processing.some(job => ['WAITING', 'RUNNING'].includes(job.state))) { documents.state = 'Processing'; documents.detail = 'Uploaded documents are being analysed.'; }
  else if (snapshot.dataSnapshot.documents.some(document => ['DRAFT', 'IN_REVIEW'].includes(document.reviewState))) { documents.state = 'Needs review'; documents.detail = 'Confirm document classifications before preparation.'; }
  return [group('Client and applicant', 'applicant', input.clientLinked ? `${href}#edit-client` : `${href}#project-details`), group('Site', 'site', input.siteLinked ? `${href}#edit-site` : `${href}#project-details`), documents, hasApplication ? group('Application requirements', input.buildingWarrantApplicationId ? 'buildingWarrant' : 'planning', applicationHref) : { label: 'Application requirements', state: 'Optional', blocking: false, href: applicationHref, detail: 'Prepare an application when this project is ready.' }, group('Agent details', 'organisation', '/settings/organisation'), { label: 'Project finances', state: 'Optional', blocking: false, href: `${href}#fees`, detail: 'Professional fees do not block submission.' }];
}
