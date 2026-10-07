/** Phase 0 terminology. Existing database/wire enums remain authoritative. */
export type RunState = 'STARTING' | 'RUNNING' | 'PREPARED' | 'NEEDS_ATTENTION' | 'INTERRUPTED' | 'FAILED' | 'STOPPED';
export const objectRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export function automationRunState(status: string, result: unknown, progressStageState?: string | null): RunState | null {
  const outcome = objectRecord(result).outcome;
  if (progressStageState === 'connection_lost' && status === 'NEEDS_REVIEW') return 'INTERRUPTED';
  if (status === 'CLAIMED') return 'STARTING';
  if (status === 'IN_PROGRESS') return 'RUNNING';
  if (status === 'CANCELLED') return 'STOPPED';
  if (['FAILED', 'FAILED_RETRYABLE', 'FAILED_FINAL'].includes(status)) return 'FAILED';
  if (status === 'NEEDS_REVIEW') return 'NEEDS_ATTENTION';
  if (status === 'AWAITING_PORTAL_REVIEW') {
    return outcome === 'awaiting_user_portal_review' || outcome === 'completed_to_final_review'
      ? 'PREPARED' : 'NEEDS_ATTENTION';
  }
  if (status === 'COMPLETED') return 'PREPARED';
  return null;
}

// Never interpret AutomationJob.reviewedAt as post-automation architect review.
// It is a preparation approval timestamp in the legacy workflow.
export function applicationReviewState(runState: RunState | null, architectReviewedAt?: Date | null) {
  return architectReviewedAt ? 'REVIEWED' : runState === 'PREPARED' ? 'PREPARED' : 'NOT_PREPARED';
}

// This revision identifies the mutable row, not a full aggregate revision of
// client/site/project dependencies. Optimistic concurrency is a later phase.
export const editableRevision = (updatedAt: Date) => updatedAt.toISOString();
