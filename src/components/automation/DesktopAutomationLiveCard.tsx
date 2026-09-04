import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, Play, X } from 'lucide-react';
import AutomationFailureRecovery, { type FailureRecoveryContext } from '@/components/automation/AutomationFailureRecovery';
import { readAutomationFailureMetadata } from '@/lib/automation/failure-recovery';
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
  resultData: unknown;
  lastCheckpoint: string | null;
  stale: boolean;
};

type Props = {
  jobId: string;
  applicationId: string;
  applicationStatus: string;
  manageHref: string;
  detailsHref: string;
  initial: DesktopJobProjection;
  connectedAgent: boolean;
  applicationType: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  recoveryContext: FailureRecoveryContext;
};

const runningStatuses = new Set(['CLAIMED', 'IN_PROGRESS']);
const failedStatuses = new Set(['FAILED', 'FAILED_RETRYABLE', 'FAILED_FINAL']);
const visualCountdownDurationSeconds = 90;

const stageLabel = (stage: string | null) => ({
  validation: 'Checking the prepared application',
  browser: 'Starting the secure browser',
  login: 'Signing in',
  proposal: 'Opening the proposal',
  main_details: 'Completing application details',
  ownership: 'Completing ownership and certificates',
  documents: 'Uploading supporting documents',
  declaration: 'Completing the declaration',
  final_review: 'Finalising the application',
  fee: 'Opening the fee page',
  address_selection: 'Confirming the property address',
  applicant_details: 'Completing applicant details',
  agent_details: 'Completing agent details',
}[stage ?? ''] ?? 'Preparing the application');

const executionStartTime = (executionAuthorisedAt: string | null) => {
  if (!executionAuthorisedAt) return null;
  const timestamp = Date.parse(executionAuthorisedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const visualCountdownLabel = (seconds: number) => {
  if (seconds <= 0) return 'Finishing up…';
  if (seconds === visualCountdownDurationSeconds) return 'About 90 seconds remaining';
  if (seconds < 60) return `About ${seconds} second${seconds === 1 ? '' : 's'} remaining`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `About ${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  return `About ${minutes} min ${remainingSeconds} sec remaining`;
};

export default function DesktopAutomationLiveCard({ jobId, applicationId, applicationStatus, manageHref, detailsHref, initial, connectedAgent, applicationType, recoveryContext }: Props) {
  const [currentJobId, setCurrentJobId] = useState(jobId);
  const [job, setJob] = useState(initial);
  const [working, setWorking] = useState<'run' | 'retry' | 'reveal' | 'submit' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const submissionDialogRef = useRef<HTMLDialogElement>(null);
  const markSubmittedButtonRef = useRef<HTMLButtonElement>(null);
  const submissionInFlightRef = useRef(false);
  const [visualClock, setVisualClock] = useState(() => ({
    jobId,
    startAt: (runningStatuses.has(initial.status) || (initial.status === 'READY' && Boolean(initial.executionAuthorisedAt)))
      ? executionStartTime(initial.executionAuthorisedAt) ?? Date.now()
      : null,
  }));
  const [visualNow, setVisualNow] = useState(() => Date.now());

  const awaitingFee = job.status === 'AWAITING_PORTAL_REVIEW'
    || (job.progressStage === 'fee' && job.progressStageState === 'user_action_required');
  const addressAction = job.progressStage === 'address_selection' && job.progressStageState === 'user_action_required';
  const active = runningStatuses.has(job.status) || (job.status === 'READY' && Boolean(job.executionAuthorisedAt));
  const currentDetailsHref = currentJobId === jobId ? detailsHref : `/automation-job/${currentJobId}`;
  const isWarrant = applicationType === 'BUILDING_WARRANT';
  const viewLabel = isWarrant ? 'View Warrant' : 'View Householder';
  const visualCountdownActive = active && !awaitingFee && !addressAction;

  useEffect(() => {
    setVisualClock((current) => {
      const authorisedStartAt = executionStartTime(job.executionAuthorisedAt);
      if (current.jobId !== currentJobId) {
        return {
          jobId: currentJobId,
          startAt: active ? authorisedStartAt ?? Date.now() : null,
        };
      }
      if (authorisedStartAt !== null && current.startAt !== authorisedStartAt) {
        return { ...current, startAt: authorisedStartAt };
      }
      if (active && current.startAt === null) {
        return { ...current, startAt: Date.now() };
      }
      return current;
    });
  }, [active, currentJobId, job.executionAuthorisedAt]);

  useEffect(() => {
    if (!visualCountdownActive || visualClock.startAt === null) return;
    setVisualNow(Date.now());
    const timer = window.setInterval(() => setVisualNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [visualClock.startAt, visualCountdownActive]);

  useEffect(() => {
    if (!active && !awaitingFee) return;
    let mounted = true;
    const poll = async () => {
      try {
        const response = await apiRequest<{ job: DesktopJobProjection }>(`/api/automation-jobs/${currentJobId}/status`);
        if (mounted) setJob(response.job);
      } catch {
        // Keep the last verified projection; the next lightweight poll retries.
      }
    };
    const timer = window.setInterval(() => void poll(), awaitingFee ? 5_000 : 3_000);
    void poll();
    return () => { mounted = false; window.clearInterval(timer); };
  }, [active, awaitingFee, currentJobId]);

  const run = async () => {
    setWorking('run'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ compatibleAgentOnline: boolean }>(`/api/automation-jobs/${currentJobId}/run`, { method: 'POST' });
      setJob((current) => ({ ...current, executionAuthorisedAt: new Date().toISOString() }));
      setNotice(result.compatibleAgentOnline
        ? 'Queued. Your connected Agent will start automatically.'
        : 'Queued. Open or connect a compatible Architect Pro Agent to continue.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be queued.');
    } finally { setWorking(''); }
  };

  const retry = async () => {
    setWorking('retry'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ job: DesktopJobProjection; compatibleAgentOnline: boolean }>(`/api/automation-jobs/${currentJobId}/restart`, { method: 'POST' });
      if (!result.job.id) throw new Error('The retry job was not returned.');
      setCurrentJobId(result.job.id);
      setJob(result.job);
      setNotice(result.compatibleAgentOnline
        ? 'Queued. Your connected Agent will start automatically.'
        : 'Queued. Open or connect a compatible Architect Pro Agent to continue.');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'The application could not be retried safely.';
      setError(message);
      throw new Error(message);
    } finally { setWorking(''); }
  };

  const reveal = async () => {
    setWorking('reveal'); setError(''); setNotice('');
    try {
      await apiRequest(`/api/automation-jobs/${currentJobId}/reveal-browser`, { method: 'POST' });
      setNotice(job.status === 'COMPLETED'
        ? `Sent to your Agent. ${viewLabel} will open on this computer.`
        : 'Sent to your Agent. The existing fee browser will come to the front.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be opened.');
    } finally { setWorking(''); }
  };

  const closeSubmissionDialog = () => {
    submissionDialogRef.current?.close();
    markSubmittedButtonRef.current?.focus();
  };

  const openSubmissionDialog = () => {
    setError('');
    setNotice('');
    submissionDialogRef.current?.showModal();
  };

  const markSubmitted = async () => {
    if (submissionInFlightRef.current) return;
    if (!applicationId) {
      setError('This prepared job is not linked to an application record.');
      return;
    }
    submissionInFlightRef.current = true;
    setWorking('submit');
    setError('');
    try {
      const endpoint = isWarrant
        ? `/api/building-warrant/${applicationId}/mark-submitted`
        : `/api/planning/${applicationId}/mark-submitted`;
      await apiRequest(endpoint, { method: 'POST', json: {} });
      submissionDialogRef.current?.close();
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Submission could not be recorded.');
    } finally {
      submissionInFlightRef.current = false;
      setWorking('');
    }
  };

  const progress = Math.max(0, Math.min(100, job.progressPercent ?? 0));
  const visualRemaining = visualCountdownActive && visualClock.startAt !== null
    ? Math.max(0, visualCountdownDurationSeconds - Math.floor((visualNow - visualClock.startAt) / 1_000))
    : null;
  const visualEta = visualRemaining === null ? null : visualCountdownLabel(visualRemaining);
  const failure = useMemo(
    () => readAutomationFailureMetadata(job.resultData, job.status, job.progressStage ?? job.lastCheckpoint),
    [job.lastCheckpoint, job.progressStage, job.resultData, job.status],
  );
  const applicationHasProgressed = !['NOT_STARTED', 'DRAFTING'].includes(applicationStatus);
  const humanApplicationStatus = applicationStatus
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const submissionDialog = (
    <dialog ref={submissionDialogRef} onCancel={closeSubmissionDialog} aria-labelledby={`confirm-submission-${applicationId}`} className="settings-dialog m-auto w-[min(34rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`confirm-submission-${applicationId}`} className="text-xl font-semibold">Confirm submission</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-stone-600">
              Confirm that you have submitted this application through {isWarrant ? 'eBuilding Standards' : 'ePlanning'}. Architect Pro will record it as submitted and begin tracking the council stage.
            </p>
          </div>
          <button type="button" onClick={closeSubmissionDialog} disabled={working === 'submit'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/40" aria-label="Cancel submission confirmation">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
          <button type="button" className="btn btn-secondary" disabled={working === 'submit'} onClick={closeSubmissionDialog}>Cancel</button>
          <button type="button" className="btn btn-primary gap-2" disabled={working === 'submit'} onClick={() => void markSubmitted()}>
            {working === 'submit' && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {working === 'submit' ? 'Recording…' : 'Confirm submitted'}
          </button>
        </div>
      </div>
    </dialog>
  );

  if (applicationHasProgressed) return (
    <section className="border-l-4 border-l-moss bg-emerald-50/55 p-4 sm:px-5" aria-live="polite">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 shrink-0 text-moss" size={21} aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-moss">Application lifecycle</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">{applicationStatus === 'SUBMITTED' ? 'Submitted — waiting for council' : humanApplicationStatus}</h3>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-5 text-stone-600">
        {applicationStatus === 'SUBMITTED'
          ? 'Architect Pro has recorded the manual portal submission. No prepared-review action remains.'
          : 'This application has progressed beyond portal preparation. Its canonical application status now takes priority.'}
      </p>
      <div className="mt-4"><a className="text-sm font-semibold text-stone-600 hover:text-ink" href={currentDetailsHref}>View run details</a></div>
    </section>
  );

  if (job.status === 'COMPLETED') return (
    <section className="border-l-4 border-l-moss bg-emerald-50/55 p-4 sm:px-5" aria-live="polite">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 shrink-0 text-moss" size={21} aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-moss">Prepared application</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">Prepared — needs your review</h3>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-5 text-stone-600">
        Architect Pro prepared this application but did not submit it. {isWarrant ? 'Complete payment, review and submit it in eBuilding Standards.' : 'Review and submit it in ePlanning.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={working === 'reveal'} onClick={() => void reveal()}>
          {working === 'reveal' ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {working === 'reveal' ? 'Opening…' : `Review in ${isWarrant ? 'eBuilding Standards' : 'ePlanning'}`}
        </button>
        <button ref={markSubmittedButtonRef} type="button" className="btn btn-secondary" disabled={working === 'submit'} onClick={openSubmissionDialog}>Mark as submitted</button>
        <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={currentDetailsHref}>View run details</a>
      </div>
      {notice && <p role="status" className="mt-3 text-sm font-medium text-moss">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
      {submissionDialog}
    </section>
  );

  if (awaitingFee) return (
    <section className="border-l-4 border-l-amber-500 bg-amber-50/70 p-4 sm:px-5" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Prepared application</p>
      <h3 className="mt-1 text-lg font-semibold text-ink">Prepared — needs your review</h3>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-stone-600">Architect Pro prepared the portal draft and calculated the fee. Complete payment, review and submit it yourself in eBuilding Standards.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={working === 'reveal'} onClick={() => void reveal()}>
          {working === 'reveal' ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {working === 'reveal' ? 'Opening browser…' : 'Continue in eBuilding Standards'}
        </button>
        <button ref={markSubmittedButtonRef} type="button" className="btn btn-secondary" disabled={working === 'submit'} onClick={openSubmissionDialog}>Mark as submitted</button>
        <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={currentDetailsHref}>View run details</a>
      </div>
      {notice && <p role="status" className="mt-3 text-sm font-medium text-amber-900">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
      {submissionDialog}
    </section>
  );

  if (failedStatuses.has(job.status)) return (
    <section className="border-l-4 border-l-red-700 bg-red-50/75 p-4 sm:px-5" aria-live="assertive">
      <div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-red-700" size={20} />
        <div><p className="text-xs font-semibold uppercase tracking-wide text-red-800">Automation stopped</p><h3 className="mt-1 text-lg font-semibold text-ink">{failure.headline || 'The application could not be completed'}</h3></div>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-5 text-stone-700">{job.error || job.resultSummary || 'Architect Pro stopped before taking any further portal action.'}</p>
      <p className="mt-2 text-sm text-stone-600"><span className="font-semibold">Stage:</span> {failure.stageDescription || stageLabel(failure.stage)}</p>
      {failure.explanation && <p className="mt-2 text-sm font-medium text-stone-700">{failure.explanation}</p>}
      <AutomationFailureRecovery metadata={failure} context={recoveryContext} applicationType={applicationType} retrying={working === 'retry'} onRetry={retry} detailsHref={currentDetailsHref} />
      {notice && <p role="status" className="mt-3 text-sm font-medium text-moss">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
      <details className="mt-3 text-xs text-stone-600"><summary className="cursor-pointer font-semibold">Technical details</summary><p className="mt-2">Job {currentJobId} · {job.status} · {failure.category ?? 'AUTOMATION_FAILED'} · {failure.stage ?? 'stage not reported'}</p></details>
    </section>
  );

  if (active || addressAction) return (
    <section className="p-4 sm:px-5" aria-live="polite">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-moss">{addressAction ? 'Action required' : job.status === 'READY' ? 'Queued' : 'Agent running'}</p><h3 className="mt-1 font-semibold text-ink">{job.stale ? 'Agent connection lost' : addressAction ? 'Confirm the property address' : stageLabel(job.progressStage)}</h3><p className="mt-1 text-sm text-stone-600">{job.progressMessage || (job.status === 'READY' ? 'Waiting for your Agent to claim the application.' : 'Chrome is running securely in the background.')}</p></div><span className="text-sm font-semibold text-moss">{progress}%</span></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full rounded-full bg-moss transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
      {visualEta && <p className="mt-2 text-xs text-stone-500" aria-live="off">{visualEta}</p>}
      {addressAction && <p className="mt-3 text-sm font-medium text-amber-800">Choose the correct address in the Agent. The browser remains paused safely.</p>}
      <div className="mt-3"><a className="text-sm font-semibold text-stone-600 hover:text-ink" href={currentDetailsHref}>View details</a></div>
    </section>
  );

  if (job.status === 'READY') return (
    <section className="p-4 sm:px-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-moss">Ready to run</p>
      <h3 className="mt-1 font-semibold text-ink">Application prepared</h3>
      <p className="mt-1 text-sm text-stone-600">{connectedAgent ? 'Your connected Agent can prepare this application in the background.' : 'Run the application, then open or connect the Desktop Agent.'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={working === 'run'} onClick={() => void run()}>{working === 'run' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{working === 'run' ? 'Queuing…' : 'Run application'}</button>
        <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={currentDetailsHref}>View details</a>
      </div>
      {!connectedAgent && <details className="mt-3 text-sm text-stone-600"><summary className="cursor-pointer font-semibold">Desktop fallback</summary><p className="mt-2">Open the Agent manually if it is installed but not currently connected.</p></details>}
      {notice && <p role="status" className="mt-3 text-sm font-medium text-moss">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
    </section>
  );

  const finalTitle = job.status === 'CANCELLED' ? 'Automation cancelled' : 'Needs your attention';
  const finalMessage = job.status === 'CANCELLED' ? 'The previous run stopped safely. Review the application before starting again.' : job.resultSummary || 'Review the application before continuing.';
  return <section className="p-4 sm:px-5"><p className="font-semibold text-ink">{finalTitle}</p><p className="mt-1 text-sm text-stone-600">{finalMessage}</p><a className="mt-3 inline-flex text-sm font-semibold text-moss hover:text-ink" href={manageHref}>View application</a></section>;
}
