export type ProjectNextActionTone = 'neutral' | 'info' | 'warning' | 'danger';

export type ProjectNextActionInput = {
  projectId: string;
  stage: string;
  documentCount: number;
  documentReviewCount: number;
  hasLocationPlan: boolean;
  planningStatus?: string | null;
  warrantStatus?: string | null;
  readyAutomationJobCount: number;
  nextDeadline?: {
    title: string;
    dueDate: Date | string;
    status?: string | null;
  } | null;
};

export type ProjectNextAction = {
  label: string;
  href: string;
  tone: ProjectNextActionTone;
};

const dateKey = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return ${part('year')}--;
};

export const isProjectDateOverdue = (value: Date | string, now: Date = new Date()) => dateKey(value) < dateKey(now);

const shortDate = (value: Date | string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Europe/London',
}).format(new Date(value));

export const getProjectNextAction = (
  input: ProjectNextActionInput,
  now: Date = new Date(),
): ProjectNextAction => {
  const projectHref = `/projects/${input.projectId}`;
  const deadlineHref = `/deadlines?projectId=${input.projectId}`;
  const nextDeadline = input.nextDeadline;

  if (nextDeadline && isProjectDateOverdue(nextDeadline.dueDate, now)) {
    return { label: `Overdue: ${nextDeadline.title}`, href: deadlineHref, tone: 'danger' };
  }

  if (input.planningStatus === 'FURTHER_INFORMATION_REQUESTED') {
    return { label: 'Respond to planning information request', href: `${projectHref}/planning`, tone: 'danger' };
  }

  if (input.warrantStatus === 'FURTHER_INFORMATION_REQUESTED') {
    return { label: 'Respond to warrant information request', href: `${projectHref}/building-warrant`, tone: 'danger' };
  }

  if (input.documentReviewCount > 0) {
    const suffix = input.documentReviewCount === 1 ? 'classification' : 'classifications';
    return { label: `Review ${input.documentReviewCount} document ${suffix}`, href: `${projectHref}/files`, tone: 'warning' };
  }

  if (input.documentCount === 0) {
    return { label: 'Upload documents', href: `/documents/upload?projectId=${input.projectId}`, tone: 'warning' };
  }

  if (!input.hasLocationPlan) {
    return { label: 'Upload location plan', href: `/documents/upload?projectId=${input.projectId}`, tone: 'warning' };
  }

  if (input.readyAutomationJobCount > 0) {
    const suffix = input.readyAutomationJobCount === 1 ? 'job' : 'jobs';
    return { label: `${input.readyAutomationJobCount} automation ${suffix} ready`, href: `/automation-jobs?projectId=${input.projectId}`, tone: 'info' };
  }

  if (input.stage === 'PLANNING') {
    if (!input.planningStatus || input.planningStatus === 'NOT_STARTED') {
      return { label: 'Prepare planning application', href: `${projectHref}/planning`, tone: 'info' };
    }
    if (input.planningStatus === 'DRAFTING') {
      return { label: 'Complete planning application', href: `${projectHref}/planning`, tone: 'info' };
    }
    if (input.planningStatus === 'SUBMITTED') {
      return { label: 'Await planning validation', href: `${projectHref}/planning`, tone: 'neutral' };
    }
    if (input.planningStatus === 'VALIDATED' || input.planningStatus === 'IN_REVIEW') {
      return { label: 'Await planning decision', href: `${projectHref}/planning`, tone: 'neutral' };
    }
  }

  if (input.stage === 'BUILDING_WARRANT') {
    if (!input.warrantStatus || input.warrantStatus === 'NOT_STARTED') {
      return { label: 'Add building warrant record', href: `${projectHref}/building-warrant`, tone: 'info' };
    }
    if (input.warrantStatus === 'DRAFTING') {
      return { label: 'Submit building warrant', href: `${projectHref}/building-warrant`, tone: 'info' };
    }
    if (input.warrantStatus === 'SUBMITTED' || input.warrantStatus === 'IN_REVIEW') {
      return { label: 'Await warrant response', href: `${projectHref}/building-warrant`, tone: 'neutral' };
    }
  }

  if (nextDeadline) {
    return { label: `Upcoming deadline: ${shortDate(nextDeadline.dueDate)}`, href: deadlineHref, tone: 'info' };
  }

  return { label: 'No action needed', href: projectHref, tone: 'neutral' };
};
