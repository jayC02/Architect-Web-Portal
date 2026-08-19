import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, LoaderCircle, Play } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

export type DesktopJobProjection = {
  id?: string;
  status: string;
  executionAuthorisedAt: string | null;
  progressStage: string | null;
  progressStageState: string | null;
  progressPercent: number | null;
  etaSeconds: number | null;
  progressMessage: string | null;
  resultSummary: string | null;
  error: string | null;
  stale: boolean;
};

type Props = {
  jobId: string;
  manageHref: string;
  detailsHref: string;
  initial: DesktopJobProjection;
  connectedAgent: boolean;
};

const runningStatuses = new Set(['CLAIMED', 'IN_PROGRESS']);
const failedStatuses = new Set(['FAILED', 'FAILED_RETRYABLE', 'FAILED_FINAL']);

const stageLabel = (stage: string | null) => ({
  validation: 'Checking the prepared application',
  browser: 'Starting the secure browser',
  login: 'Signing in',
  proposal: 'Opening the proposal',
  main_details: 'Completing application details',
  ownership: 'Completing ownership and certificates',
  documents: 'Uploading supporting documents',
  declaration: 'Completing the declaration',
  fee: 'Opening the fee page',
  address_selection: 'Confirming the property address',
}[stage ?? ''] ?? 'Preparing the application');

const etaLabel = (seconds: number | null) => {
  if (seconds === null) return null;
  if (seconds <= 15) return 'Finishing up…';
  if (seconds < 60) return 'Less than a minute remaining';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `About ${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
};

export default function DesktopAutomationLiveCard({ jobId, manageHref, detailsHref, initial, connectedAgent }: Props) {
  const [job, setJob] = useState(initial);
  const [working, setWorking] = useState<'run' | 'reveal' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const awaitingFee = job.status === 'AWAITING_PORTAL_REVIEW'
    || (job.progressStage === 'fee' && job.progressStageState === 'user_action_required');
  const addressAction = job.progressStage === 'address_selection' && job.progressStageState === 'user_action_required';
  const active = runningStatuses.has(job.status) || (job.status === 'READY' && Boolean(job.executionAuthorisedAt));

  useEffect(() => {
    if (!active && !awaitingFee) return;
    let mounted = true;
    const poll = async () => {
      try {
        const response = await apiRequest<{ job: DesktopJobProjection }>(`/api/automation-jobs/${jobId}/status`);
        if (mounted) setJob(response.job);
      } catch {
        // Keep the last verified projection; the next lightweight poll retries.
      }
    };
    const timer = window.setInterval(() => void poll(), awaitingFee ? 5_000 : 3_000);
    void poll();
    return () => { mounted = false; window.clearInterval(timer); };
  }, [active, awaitingFee, jobId]);

  const run = async () => {
    setWorking('run'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ compatibleAgentOnline: boolean }>(`/api/automation-jobs/${jobId}/run`, { method: 'POST' });
      setJob((current) => ({ ...current, executionAuthorisedAt: new Date().toISOString() }));
      setNotice(result.compatibleAgentOnline
        ? 'Queued. Your connected Agent will start automatically.'
        : 'Queued. Open or connect a compatible Architect Pro Agent to continue.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be queued.');
    } finally { setWorking(''); }
  };

  const reveal = async () => {
    setWorking('reveal'); setError(''); setNotice('');
    try {
      await apiRequest(`/api/automation-jobs/${jobId}/reveal-browser`, { method: 'POST' });
      setNotice('Sent to your Agent. The existing fee browser will come to the front.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The fee browser could not be opened.');
    } finally { setWorking(''); }
  };

  const progress = Math.max(0, Math.min(100, job.progressPercent ?? 0));
  const eta = useMemo(() => awaitingFee || addressAction || job.stale ? null : etaLabel(job.etaSeconds), [addressAction, awaitingFee, job.etaSeconds, job.stale]);

  if (awaitingFee) return (
    <section className="border-l-4 border-l-amber-500 bg-amber-50/70 p-4 sm:px-5" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Needs your attention</p>
      <h3 className="mt-1 text-lg font-semibold text-ink">Complete the fee in the browser</h3>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-stone-600">Automated preparation is complete. Review the portal and complete or submit the fee yourself.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={working === 'reveal'} onClick={() => void reveal()}>
          {working === 'reveal' ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {working === 'reveal' ? 'Opening browser…' : 'Continue fee in browser'}
        </button>
        <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={detailsHref}>View run details</a>
      </div>
      {notice && <p role="status" className="mt-3 text-sm font-medium text-amber-900">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
    </section>
  );

  if (failedStatuses.has(job.status)) return (
    <section className="border-l-4 border-l-red-700 bg-red-50/75 p-4 sm:px-5" aria-live="assertive">
      <div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-red-700" size={20} />
        <div><p className="text-xs font-semibold uppercase tracking-wide text-red-800">Automation stopped</p><h3 className="mt-1 text-lg font-semibold text-ink">The application could not be completed</h3></div>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-5 text-stone-700">{job.error || job.resultSummary || 'Architect Pro stopped before taking any further portal action.'}</p>
      <p className="mt-2 text-sm text-stone-600"><span className="font-semibold">Stage:</span> {stageLabel(job.progressStage)} · {job.status === 'FAILED_RETRYABLE' ? 'Safe to review for retry' : 'Review before retrying'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><a className="btn btn-primary" href={detailsHref}>Review issue</a><a className="text-sm font-semibold text-stone-600 hover:text-ink" href={manageHref}>View application</a></div>
      <details className="mt-3 text-xs text-stone-600"><summary className="cursor-pointer font-semibold">Technical details</summary><p className="mt-2">Job {jobId} · {job.status} · {job.progressStage ?? 'stage not reported'}</p></details>
    </section>
  );

  if (active || addressAction) return (
    <section className="p-4 sm:px-5" aria-live="polite">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-moss">{addressAction ? 'Action required' : job.status === 'READY' ? 'Queued' : 'Agent running'}</p><h3 className="mt-1 font-semibold text-ink">{job.stale ? 'Agent connection lost' : addressAction ? 'Confirm the property address' : stageLabel(job.progressStage)}</h3><p className="mt-1 text-sm text-stone-600">{job.progressMessage || (job.status === 'READY' ? 'Waiting for your Agent to claim the application.' : 'Chrome is running securely in the background.')}</p></div><span className="text-sm font-semibold text-moss">{progress}%</span></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full rounded-full bg-moss transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
      {eta && <p className="mt-2 text-xs text-stone-500">{eta}</p>}
      {addressAction && <p className="mt-3 text-sm font-medium text-amber-800">Choose the correct address in the Agent. The browser remains paused safely.</p>}
      <div className="mt-3"><a className="text-sm font-semibold text-stone-600 hover:text-ink" href={detailsHref}>View details</a></div>
    </section>
  );

  if (job.status === 'READY') return (
    <section className="p-4 sm:px-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-moss">Ready to run</p>
      <h3 className="mt-1 font-semibold text-ink">Application prepared</h3>
      <p className="mt-1 text-sm text-stone-600">{connectedAgent ? 'Your connected Agent can prepare this application in the background.' : 'Run the application, then open or connect the Desktop Agent.'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={working === 'run'} onClick={() => void run()}>{working === 'run' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{working === 'run' ? 'Queuing…' : 'Run application'}</button>
        <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={detailsHref}>View details</a>
      </div>
      {!connectedAgent && <details className="mt-3 text-sm text-stone-600"><summary className="cursor-pointer font-semibold">Desktop fallback</summary><p className="mt-2">Open the Agent manually if it is installed but not currently connected.</p></details>}
      {notice && <p role="status" className="mt-3 text-sm font-medium text-moss">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
    </section>
  );

  const finalTitle = job.status === 'COMPLETED' ? 'Application prepared' : job.status === 'CANCELLED' ? 'Automation cancelled' : 'Needs your attention';
  const finalMessage = job.status === 'CANCELLED' ? 'The previous run stopped safely. Review the application before starting again.' : job.resultSummary || 'Review the application before continuing.';
  return <section className="p-4 sm:px-5"><p className="font-semibold text-ink">{finalTitle}</p><p className="mt-1 text-sm text-stone-600">{finalMessage}</p><a className="mt-3 inline-flex text-sm font-semibold text-moss hover:text-ink" href={manageHref}>View application</a></section>;
}
