import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ListOrdered } from 'lucide-react';

type Job = {
  id: string; title: string; type: string; status: string;
  progressPercent: number | null; progressMessage: string | null;
  project: { id: string; name: string };
};
type Queue = { active: Job[]; recent: Job[] };
const labels: Record<string, string> = {
  READY: 'Queued', CLAIMED: 'Starting', IN_PROGRESS: 'In progress',
  NEEDS_REVIEW: 'Needs attention', AWAITING_PORTAL_REVIEW: 'Ready for review',
  COMPLETED: 'Complete', FAILED_RETRYABLE: 'Needs attention', FAILED_FINAL: 'Needs attention', FAILED: 'Needs attention',
};

export default function AgentQueueDropdown() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
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
      try {
        const response = await fetch('/api/automation-jobs/queue', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Queue unavailable');
        const next = await response.json();
        if (!controller.signal.aborted) { setQueue(next); setError(false); }
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
  const renderJob = (job: Job, position?: number) => (
    <li key={job.id}>
      <a href={`/automation-job/${job.id}`} className="block rounded-md px-3 py-3 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-semibold text-ink">{job.project.name}</span>
          <span className="shrink-0 text-xs text-stone-600">{job.status === 'READY' ? `Queued · ${position}` : labels[job.status] || 'Needs attention'}</span>
        </div>
        <p className="mt-1 text-xs text-stone-600">{job.type === 'BUILDING_WARRANT' ? 'Building warrant' : 'Planning permission'} · {job.title}</p>
        {job.status === 'IN_PROGRESS' && <>
          <p className="mt-2 text-xs text-stone-600">{job.progressMessage || 'Preparing application'}</p>
          <div className="mt-2 flex items-center gap-2">
            <progress aria-label={`${job.project.name} application progress`} max={100} value={job.progressPercent == null ? undefined : Math.max(0, Math.min(100, job.progressPercent))} className="h-2 w-full accent-moss" />
            {job.progressPercent != null && <span className="text-xs text-stone-600">{Math.max(0, Math.min(100, job.progressPercent))}%</span>}
          </div>
        </>}
      </a>
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
        {!queue && !error && <p role="status" className="p-3 text-sm text-stone-600">Loading jobs…</p>}
        {queue && <>
          {!queue.active.length && <p className="p-3 text-sm text-stone-600">No jobs queued. Prepare an application to add it here.</p>}
          <ul>{queue.active.map(job => renderJob(job, job.status === 'READY' ? ++position : undefined))}</ul>
          {queue.recent.length > 0 && <><h3 className="border-t border-stone-100 px-3 pt-3 text-xs font-semibold text-stone-500">Recent results · latest 10</h3><ul>{queue.recent.map(job => renderJob(job))}</ul></>}
        </>}
      </div>
    </section>}
  </div>;
}
