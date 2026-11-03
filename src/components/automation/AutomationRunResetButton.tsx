import { useId, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, X } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Props = {
  applicationId: string;
  type: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  currentJobId: string | null;
};

export default function AutomationRunResetButton({ applicationId, type, currentJobId }: Props) {
  const label = type === 'BUILDING_WARRANT' ? 'Building Warrant' : 'Planning';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const headingId = useId();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (inFlight.current) return;
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };
  const reset = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError('');
    try {
      // Retain the request identity if the response is lost. Retrying the
      // button must return the saved replacement rather than make another.
      requestId.current ??= crypto.randomUUID();
      const result = await apiRequest<{ ok?: unknown; jobId?: unknown }>('/api/automation-jobs/reset', { method: 'POST', json: {
        applicationId, type, expectedJobId: currentJobId, requestId: requestId.current,
      } });
      if (result.ok !== true || typeof result.jobId !== 'string' || !result.jobId) {
        throw new Error('The reset response was incomplete. Try again to confirm the same reset safely, or refresh the project.');
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof TypeError
        ? 'The reset response could not be confirmed. Try again to check the same reset safely, or refresh the project.'
        : cause instanceof Error ? cause.message : 'The reset could not be confirmed. Try again or refresh the project.');
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  return <div className="border-t border-stone-200 px-4 py-3 sm:px-5">
    <button ref={triggerRef} type="button" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-stone-600 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/40" disabled={working} onClick={() => dialogRef.current?.showModal()}>
      <RotateCcw size={15} aria-hidden="true" />Reset {label}
    </button>
    <dialog ref={dialogRef} aria-labelledby={headingId} onCancel={event => { event.preventDefault(); close(); }} className="settings-dialog m-auto w-[min(34rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="text-xl font-semibold">Reset {label}?</h2>
          <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-moss/40" aria-label="Close reset dialog" disabled={working} onClick={close}><X size={20} aria-hidden="true" /></button>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-600">Prepare a fresh {label.toLowerCase()} run using your latest saved site, client, application details and documents. An active run will stop safely before the new one can start.</p>
        <p className="mt-3 text-sm leading-6 text-stone-600">Previous runs remain in history. Existing council drafts and recorded submissions are kept. Use Run application when you are ready to start again.</p>
        {error && <p role="alert" className="mt-4 break-words rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
          <button type="button" className="btn btn-secondary" disabled={working} onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary gap-2" disabled={working} onClick={() => void reset()}>
            {working && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}{working ? 'Resetting…' : `Reset ${label} run`}
          </button>
        </div>
      </div>
    </dialog>
  </div>;
}
