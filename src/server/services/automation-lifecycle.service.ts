import { AutomationJobStatus } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';

const transitions: Record<AutomationJobStatus, ReadonlySet<AutomationJobStatus>> = {
  DRAFT: new Set([
    AutomationJobStatus.PREFLIGHT_REQUIRED,
    AutomationJobStatus.CANCELLED,
  ]),
  PREFLIGHT_REQUIRED: new Set([
    AutomationJobStatus.NEEDS_INPUT,
    AutomationJobStatus.READY,
    AutomationJobStatus.CANCELLED,
  ]),
  NEEDS_INPUT: new Set([
    AutomationJobStatus.PREFLIGHT_REQUIRED,
    AutomationJobStatus.CANCELLED,
  ]),
  READY: new Set([
    AutomationJobStatus.CLAIMED,
    AutomationJobStatus.STALE,
    AutomationJobStatus.CANCELLED,
  ]),
  STALE: new Set([AutomationJobStatus.PREFLIGHT_REQUIRED, AutomationJobStatus.CANCELLED]),
  CLAIMED: new Set([
    AutomationJobStatus.READY,
    AutomationJobStatus.IN_PROGRESS,
    AutomationJobStatus.FAILED_RETRYABLE,
    AutomationJobStatus.CANCELLED,
  ]),
  IN_PROGRESS: new Set([
    AutomationJobStatus.NEEDS_REVIEW,
    AutomationJobStatus.AWAITING_PORTAL_REVIEW,
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.FAILED_RETRYABLE,
    AutomationJobStatus.FAILED_FINAL,
    AutomationJobStatus.CANCELLED,
  ]),
  NEEDS_REVIEW: new Set([
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.CANCELLED,
  ]),
  AWAITING_PORTAL_REVIEW: new Set([
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.CANCELLED,
  ]),
  COMPLETED: new Set(),
  FAILED_RETRYABLE: new Set([
    AutomationJobStatus.PREFLIGHT_REQUIRED,
    AutomationJobStatus.CANCELLED,
  ]),
  FAILED_FINAL: new Set(),
  FAILED: new Set([
    AutomationJobStatus.PREFLIGHT_REQUIRED,
    AutomationJobStatus.CANCELLED,
  ]),
  CANCELLED: new Set(),
};

export const assertAutomationJobTransition = (
  current: AutomationJobStatus,
  next: AutomationJobStatus,
) => {
  if (current === next) return;
  if (!transitions[current]?.has(next)) {
    throw new HttpError(409, `Automation job cannot move from ${current} to ${next}.`);
  }
};

export const isAutomationJobTerminal = (status: AutomationJobStatus) =>
  status === AutomationJobStatus.COMPLETED
  || status === AutomationJobStatus.FAILED_FINAL
  || status === AutomationJobStatus.CANCELLED;
