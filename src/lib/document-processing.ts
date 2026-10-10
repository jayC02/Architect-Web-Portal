export const PROCESSING_ATTEMPTS = 5;
export const PROCESSING_LEASE_MS = 210_000;
export const PROCESSING_WORKER_BUDGET_MS = 230_000;
export const processingRetryDelay = (attempt: number) => Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
export const leaseIsCurrent = (job: { state: string; leaseOwner: string | null; leaseGeneration: number; leaseExpiresAt: Date | null }, owner: string, generation: number, now = new Date()) => job.state === 'RUNNING' && job.leaseOwner === owner && job.leaseGeneration === generation && Boolean(job.leaseExpiresAt && job.leaseExpiresAt > now);
export const processingEnabled = () => process.env.DOCUMENT_PROCESSING_ENABLED === 'true';
