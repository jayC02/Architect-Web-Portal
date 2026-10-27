// Dashboard-only projections. Dates are calendar days in the practice's UK timezone.
export const dashboardDayKey = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const dashboardDeadlineWindow = (now: Date, range: number) => {
  const firstDay = dashboardDayKey(now);
  const last = new Date(`${firstDay}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + range - 1);
  const lastDay = last.toISOString().slice(0, 10);
  const utcEnd = new Date(`${lastDay}T23:59:59.999Z`);
  // London is already on the following day at this UTC time during BST.
  // Use its actual end of day for both deadline and application target queries.
  const queryEnd = new Date(utcEnd.getTime() - (dashboardDayKey(utcEnd) > lastDay ? 3_600_000 : 0));
  return { firstDay, lastDay, queryEnd };
};

export const dashboardPhase = (stage: string, status: string) => {
  if (status === 'ARCHIVED' || stage === 'ARCHIVED') return null;
  if (status === 'COMPLETED' || stage === 'COMPLETION') return 'complete';
  if (stage === 'SURVEY' || stage === 'DESIGN') return 'documents';
  if (stage === 'PLANNING') return 'planning';
  if (stage === 'BUILDING_WARRANT' || stage === 'CONSTRUCTION') return 'warrant';
  return stage === 'LEAD' ? 'lead' : null;
};

type AutomationRecord = {
  id: string; projectId: string; type: string; status: string; applicationId: string | null;
  createdAt: Date; executionAuthorisedAt: Date | null; agentHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null; preparedAt: Date | null;
};
export type DashboardAutomationState = 'ready' | 'queued' | 'running' | 'connectionLost' | 'needsAttention' | 'history';

export const dashboardPreparationCurrent = (preflight: string | null, preparedSource: Date | null, currentSource: Date | null) =>
  Boolean(preflight === 'READY' && preparedSource && currentSource && currentSource <= preparedSource);

export const dashboardAutomationState = (job: AutomationRecord, now: Date): DashboardAutomationState => {
  if (['COMPLETED', 'CANCELLED', 'FAILED_FINAL'].includes(job.status)) return 'history';
  if (!job.applicationId) return 'needsAttention';
  if (job.status === 'CLAIMED' || job.status === 'IN_PROGRESS') {
    // Match the Agent's 90-second health window, as well as its execution lease.
    const heartbeatFresh = job.agentHeartbeatAt && now.getTime() - job.agentHeartbeatAt.getTime() < 90_000;
    return heartbeatFresh && job.leaseExpiresAt && job.leaseExpiresAt > now ? 'running' : 'connectionLost';
  }
  if (job.status === 'READY') {
    if (!job.preparedAt) return 'needsAttention';
    return job.executionAuthorisedAt ? 'queued' : 'ready';
  }
  return 'needsAttention';
};

export const currentDashboardJobs = <T extends AutomationRecord>(jobs: T[]) => {
  const current = new Map<string, T>();
  // Preserve execution ownership, as the application workspace does. A newer
  // preparation cannot bypass an unresolved claim, even when its connection is lost.
  const owned = (job: T) => ['CLAIMED', 'IN_PROGRESS'].includes(job.status);
  for (const job of [...jobs].sort((a, b) => Number(owned(b)) - Number(owned(a)) || b.createdAt.getTime() - a.createdAt.getTime())) {
    const family = job.type === 'BUILDING_WARRANT' ? 'warrant' : 'planning';
    const key = `${job.projectId}:${family}:${job.applicationId ?? job.id}`;
    if (!current.has(key)) current.set(key, job);
  }
  return [...current.values()];
};
