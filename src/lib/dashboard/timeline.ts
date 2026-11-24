// Turns a project's application dates into bars and markers for the dashboard timeline.
// Pure and date-only so it can be tested without a browser or database.

export type TimelineApplication = {
  id: string;
  status: string;
  createdAt: string | Date;
  submissionDate?: string | Date | null;
  validDate?: string | Date | null;
  targetDate?: string | Date | null;
  decisionDate?: string | Date | null;
  reference?: string | null;
};

export type TimelineWarrant = TimelineApplication & {
  completionCertificateStatus?: string | null;
  completionPreparedAt?: string | Date | null;
};

export type TimelineInput = {
  planning?: TimelineApplication | null;
  warrant?: TimelineWarrant | null;
  deadlines?: { id: string; title: string; dueDate: string | Date }[];
};

export type TimelineLane = 'planning' | 'warrant';
export type TimelinePhase = 'planning' | 'warrant' | 'completion';
export type TimelineBarState = 'preparing' | 'council' | 'projected' | 'decided';

export type TimelineBar = {
  lane: TimelineLane;
  phase: TimelinePhase;
  state: TimelineBarState;
  start: number;
  end: number;
  label: string;
};

export type TimelineMarkerKind = 'submitted' | 'validated' | 'target' | 'approved' | 'refused' | 'deadline' | 'overdue';

export type TimelineMarker = {
  lane: TimelineLane | 'deadline';
  kind: TimelineMarkerKind;
  at: number;
  label: string;
};

const DAY = 86_400_000;
const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : null);
const notStarted = (status: string) => status === 'NOT_STARTED';
const refusedStatuses = new Set(['REFUSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']);

const applicationBars = (
  application: TimelineApplication,
  lane: TimelineLane,
  name: string,
  now: number,
) => {
  const bars: TimelineBar[] = [];
  const markers: TimelineMarker[] = [];
  if (notStarted(application.status)) return { bars, markers };
  const created = time(application.createdAt) ?? now;
  const submitted = time(application.submissionDate);
  const decided = time(application.decisionDate);
  const target = time(application.targetDate);
  const validated = time(application.validDate);
  const refused = refusedStatuses.has(application.status);

  // Preparing runs until it was submitted; with no submission it is still going on.
  const prepEnd = submitted ?? (decided ?? now);
  if (prepEnd > created) bars.push({ lane, phase: lane, state: 'preparing', start: created, end: prepEnd, label: `${name} being prepared` });
  if (submitted) {
    const councilEnd = decided ?? Math.max(now, submitted + DAY);
    bars.push({ lane, phase: lane, state: decided ? 'decided' : 'council', start: submitted, end: councilEnd, label: `${name} with the council` });
    markers.push({ lane, kind: 'submitted', at: submitted, label: `${name} submitted` });
    // Where the council's target date is still ahead, show the expected run-on.
    if (!decided && target && target > councilEnd) {
      bars.push({ lane, phase: lane, state: 'projected', start: councilEnd, end: target, label: `${name} decision expected` });
    }
  }
  if (validated) markers.push({ lane, kind: 'validated', at: validated, label: `${name} validated` });
  if (target && !decided) markers.push({ lane, kind: 'target', at: target, label: `${name} target date` });
  if (decided) markers.push({ lane, kind: refused ? 'refused' : 'approved', at: decided, label: `${name} ${refused ? 'refused' : lane === 'warrant' ? 'granted' : 'approved'}` });
  return { bars, markers };
};

export const buildProjectTimeline = (input: TimelineInput, nowValue: Date = new Date()) => {
  const now = nowValue.getTime();
  const bars: TimelineBar[] = [];
  const markers: TimelineMarker[] = [];
  if (input.planning) {
    const result = applicationBars(input.planning, 'planning', 'Planning', now);
    bars.push(...result.bars); markers.push(...result.markers);
  }
  if (input.warrant) {
    const result = applicationBars(input.warrant, 'warrant', 'Building warrant', now);
    bars.push(...result.bars); markers.push(...result.markers);
    const completion = input.warrant.completionCertificateStatus;
    if (completion && ['DRAFTING', 'SUBMITTED'].includes(completion)) {
      const start = time(input.warrant.completionPreparedAt) ?? time(input.warrant.decisionDate) ?? now - DAY;
      bars.push({
        lane: 'warrant', phase: 'completion', state: completion === 'SUBMITTED' ? 'council' : 'preparing',
        start, end: Math.max(now, start + DAY),
        label: completion === 'SUBMITTED' ? 'Completion certificate with the council' : 'Completion certificate being prepared',
      });
    }
  }
  for (const deadline of input.deadlines ?? []) {
    const at = time(deadline.dueDate);
    if (at === null) continue;
    markers.push({ lane: 'deadline', kind: at < now - DAY / 2 ? 'overdue' : 'deadline', at, label: deadline.title });
  }
  return { bars, markers };
};

// Week columns starting on Mondays that cover the visible window.
export const timelineWeeks = (start: number, weeks: number) => {
  const first = new Date(start);
  first.setUTCHours(0, 0, 0, 0);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = first.getTime() + index * 7 * DAY;
    return { start: weekStart, end: weekStart + 7 * DAY };
  });
};

export const timelineDay = DAY;
