import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ListOrdered, X, LoaderCircle } from 'lucide-react';

type Job = {
  id: string; title: string; type: string; status: string;
  progressPercent: number | null; progressMessage: string | null;
  project: { id: string; name: string };
};
type Queue = { active: Job[] };
const labels: Record<string, string> = { READY: 'Queued', CLAIMED: 'Starting', IN_PROGRESS: 'In progress' };

export default function AgentQueueDropdown() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState('');
  const removalInFlight = useRef(false);
  const removedIds = useRef(new Map<string, number>());
  const queueMutationGeneration = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const refresh = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      clearTimeout(timer);
      const requestGeneration = queueMutationGeneration.current;
      try {
        const response = await fetch('/api/automation-jobs/queue', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Queue unavailable');
        const next = await response.json();
        if (!controller.signal.aborted) { setQueue({ active: next.active.filter((job: Job) => (removedIds.current.get(job.id) ?? 0) <= requestGeneration) }); setError(false);
          for (const [id, generation] of removedIds.current) if (generation <= requestGeneration) removedIds.current.delete(id);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        busy = false;
        if (!controller.signal.aborted) timer = setTimeout(refresh, 10000);
      }
    };
    void refresh();
    window.addEventListener('portal:mutation-success', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort(); clearTimeout(timer);
      window.removeEventListener('portal:mutation-success', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const removeJob = async (job: Job) => {
    if (removalInFlight.current) return;
    removalInFlight.current = true;
    setRemoving(job.id);
    setRemovalError('');
    try {
      const response = await fetch(`/api/automation-jobs/${job.id}/queue`, { method: 'DELETE', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not remove this job.');
      // Exclude it from a polling response that started before withdrawal completed.
      removedIds.current.set(job.id, ++queueMutationGeneration.current);
      setQueue(current => current ? { active: current.active.filter(item => item.id !== job.id) } : current);
      window.dispatchEvent(new CustomEvent('portal:mutation-success'));
      trigger.current?.focus();
    } catch (requestError) {
      setRemovalError(requestError instanceof Error ? requestError.message : 'Could not remove this job.');
      window.dispatchEvent(new CustomEvent('portal:mutation-success'));
    } finally {
      removalInFlight.current = false;
      setRemoving(null);
    }
  };
  const renderJob = (job: Job, position?: number) => (
    <li key={job.id} className="flex items-start gap-1">
      <a href={`/automation-job/${job.id}`} className="min-w-0 flex-1 rounded-md px-3 py-3 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-semibold text-ink">{job.project.name}</span>
          <span className="shrink-0 text-xs text-stone-600">{job.status === 'READY' ? `Queued / ${position}` : labels[job.status] || 'Queued'}</span>
        </div>
        <p className="mt-1 text-xs text-stone-600">{job.type === 'BUILDING_WARRANT' ? 'Building warrant' : 'Planning permission'} / {job.title}</p>
        {job.status === 'IN_PROGRESS' && <>
          <p className="mt-2 text-xs text-stone-600">{job.progressMessage || 'Preparing application'}</p>
          <div className="mt-2 flex items-center gap-2">
            <progress aria-label={`${job.project.name} application progress`} max={100} value={job.progressPercent == null ? undefined : Math.max(0, Math.min(100, job.progressPercent))} className="h-2 w-full accent-moss" />
            {job.progressPercent != null && <span className="text-xs text-stone-600">{Math.max(0, Math.min(100, job.progressPercent))}%</span>}
          </div>
        </>}
      </a>
      {job.status === 'READY' && <button type="button"
        aria-label={`Remove ${job.project.name} ${job.title} from queue`}
        title="Remove from queue; keep the prepared application"
        disabled={removing !== null}
        onClick={() => void removeJob(job)}
        className="mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-red-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss">
        {removing === job.id ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
      </button>}
    </li>
  );
  let position = 0;
  return <div ref={container} className="relative">
    <button ref={trigger} type="button" className="btn btn-secondary gap-2" aria-expanded={open} aria-controls="agent-job-queue" onClick={() => setOpen(!open)}>
      <ListOrdered size={16} aria-hidden="true" /> Job queue{queue ? ` (${queue.active.length})` : ''}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <section id="agent-job-queue" aria-label="Agent job queue" className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white shadow-xl">
      <div className="border-b border-stone-100 px-4 py-3"><h2 className="text-sm font-semibold">Jobs across your projects</h2><p className="mt-1 text-xs text-stone-500">Your Agent works through queued applications in order.</p></div>
      <div className="max-h-[60vh] overflow-y-auto p-2">
        {error && <p role="status" className="p-3 text-sm text-amber-800">Cannot refresh the queue. {queue ? 'Showing the last update. ' : ''}Retrying automatically.</p>}
        {removalError && <p role="alert" className="p-3 text-sm text-red-700">{removalError}</p>}
        {!queue && !error && <p role="status" className="p-3 text-sm text-stone-600">Loading jobs...</p>}
        {queue && <>
          {!queue.active.length && <p className="p-3 text-sm text-stone-600">No jobs queued. Queue a prepared application to add it here.</p>}
          <ul>{queue.active.map(job => renderJob(job, job.status === 'READY' ? ++position : undefined))}</ul>
        </>}
      </div>
    </section>}
  </div>;
}
