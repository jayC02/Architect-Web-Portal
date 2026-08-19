import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/http';

type JobProjection = {
  status: string;
  progressStage: string | null;
  progressStageState: string | null;
  progressPercent: number | null;
  etaSeconds: number | null;
  progressMessage: string | null;
  stale: boolean;
};

const etaLabel = (seconds: number | null) => {
  if (seconds === null) return null;
  if (seconds < 60) return `About ${Math.max(1, seconds)} seconds remaining`;
  return `About ${Math.ceil(seconds / 60)} minutes remaining`;
};

export default function DesktopAgentProgress({ jobId, initial }: { jobId: string; initial: JobProjection }) {
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (!['CLAIMED', 'IN_PROGRESS'].includes(job.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await apiRequest<{ job: JobProjection }>(`/api/automation-jobs/${jobId}/status`);
        if (active) setJob(response.job);
      } catch { /* retain the last verified projection */ }
    };
    const timer = window.setInterval(() => void poll(), 5_000);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [jobId, job.status]);

  const address = job.progressStage === 'address_selection' && job.progressStageState === 'user_action_required';
  const fee = job.progressStage === 'fee' || job.status === 'AWAITING_PORTAL_REVIEW';
  const eta = address || fee || job.stale ? null : etaLabel(job.etaSeconds);
  return (
    <div className="mt-4 max-w-xl" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-ink">{job.stale ? 'Agent connection lost' : address ? 'Address confirmation required' : fee ? 'Complete the fee in the browser' : job.progressMessage || 'Preparing application'}</span>
        <span className="font-semibold text-moss">{job.progressPercent ?? 0}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progressPercent ?? 0}>
        <div className="h-full rounded-full bg-moss transition-[width] motion-reduce:transition-none" style={{ width: `${job.progressPercent ?? 0}%` }} />
      </div>
      {address && <p className="mt-2 text-sm text-stone-600">Choose the correct property address in the Architect Pro Agent to continue.</p>}
      {eta && <p className="mt-2 text-xs text-stone-500">{eta}</p>}
    </div>
  );
}
