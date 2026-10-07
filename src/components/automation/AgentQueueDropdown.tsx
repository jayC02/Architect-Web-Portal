import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ListOrdered, X, LoaderCircle } from 'lucide-react';

type Job = {
  id: string; title: string; type: string; status: string;
  progressPercent: number | null; progressMessage: string | null;
  project: { id: string; name: string };
};
type Queue = { active: Job[] };
const progressClassName = 'h-2 w-full appearance-none overflow-hidden rounded-full bg-stone-200 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-stone-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-moss [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-moss';
const labels: Record<string, string> = { READY: 'Queued', CLAIMED: 'Starting', IN_PROGRESS: 'In progress' };

export default function AgentQueueDropdown() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [floating, setFloating] = useState(false);
  const [floatingTop, setFloatingTop] = useState(16);
  const [anchorSize, setAnchorSize] = useState({ width: 176, height: 40 });
  const anchor = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState('');
  const removalInFlight = useRef(false);
  const removedIds = useRef(new Map<string, number>());
  const queueMutationGeneration = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const originalPosition = anchor.current;
    if (!originalPosition) return;
    const navigation = document.querySelector<HTMLElement>('[data-mobile-navigation-header]');
    let observer: IntersectionObserver;
    const observePosition = () => {
      const navigationBottom = Math.max(0, navigation?.getBoundingClientRect().bottom ?? 0);
      setFloatingTop(navigationBottom + 16);
      observer?.disconnect();
      observer = new IntersectionObserver(([entry]) => {
        // Only float after scrolling past the original button, never before it.
        const nextFloating = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? navigationBottom);
        if (!nextFloating && preview.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
        setFloating(nextFloating);
      }, { rootMargin: `-${navigationBottom}px 0px 0px 0px`, threshold: 0 });
      observer.observe(originalPosition);
    };
    const measureAnchor = () => {
      if (container.current && getComputedStyle(container.current).position !== 'fixed') {
        const { width, height } = originalPosition.getBoundingClientRect();
        setAnchorSize(current => current.width === width && current.height === height ? current : { width, height });
      }
    };
    measureAnchor();
    observePosition();
    const sizeObserver = new ResizeObserver(measureAnchor);
    sizeObserver.observe(originalPosition);
    const navigationObserver = new ResizeObserver(observePosition);
    if (navigation) navigationObserver.observe(navigation);
    window.addEventListener('resize', observePosition);
    return () => {
      observer.disconnect(); sizeObserver.disconnect(); navigationObserver.disconnect();
      window.removeEventListener('resize', observePosition);
    };
  }, []);
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
            <progress aria-label={`${job.project.name} application progress`} max={100} value={job.progressPercent == null ? undefined : Math.max(0, Math.min(100, job.progressPercent))} className={progressClassName} />
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
  const currentJob = queue?.active.find(job => job.status !== 'READY') ?? queue?.active[0];
  const waitingCount = queue?.active.filter(job => job.status === 'READY').length ?? 0;
  return <div ref={anchor} style={floating ? anchorSize : undefined}>
    <div ref={container} data-queue-position={floating ? 'floating' : 'inline'}
      className={floating ? 'fixed right-4 z-30 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white shadow-xl sm:right-6' : 'relative'}
      style={{ ...(floating ? { top: floatingTop } : {}), '--queue-top': `${floatingTop}px` } as CSSProperties}>
    <button ref={trigger} type="button" className={`btn btn-secondary gap-2 ${floating ? 'w-full border-0' : ''}`} aria-expanded={open} aria-controls="agent-job-queue" onClick={() => setOpen(!open)}>
      <ListOrdered size={16} aria-hidden="true" /> Job queue{queue ? ` (${queue.active.length})` : ''}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {floating && !open && currentJob && <div ref={preview} className="border-t border-stone-100 px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-xs text-stone-600">
        <span>{currentJob.status === 'READY' ? 'Next in queue' : labels[currentJob.status]}</span>
        <span>{waitingCount} waiting</span>
      </div>
      <a href={`/automation-job/${currentJob.id}`} className="mt-1 block rounded-sm text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss">
        {currentJob.project.name}
      </a>
      <p className="mt-1 truncate text-xs text-stone-600">{currentJob.progressMessage || currentJob.title}</p>
      {currentJob.status === 'IN_PROGRESS' && <div className="mt-2 flex items-center gap-2">
        <progress aria-label={`${currentJob.project.name} application progress`} max={100} value={currentJob.progressPercent == null ? undefined : Math.max(0, Math.min(100, currentJob.progressPercent))} className={progressClassName} />
        {currentJob.progressPercent != null && <span className="text-xs text-stone-600">{Math.max(0, Math.min(100, currentJob.progressPercent))}%</span>}
      </div>}
      {error && <p role="status" className="mt-2 text-xs text-amber-800">Reconnecting. Showing the last update.</p>}
    </div>}
    {open && <section id="agent-job-queue" aria-label="Agent job queue" className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white shadow-xl">
      <div className="border-b border-stone-100 px-4 py-3"><h2 className="text-sm font-semibold">Jobs across your projects</h2><p className="mt-1 text-xs text-stone-500">Your Agent works through queued applications in order.</p></div>
      <div className="max-h-[min(60vh,calc(100dvh-var(--queue-top)-10rem))] overflow-y-auto p-2">
        {error && <p role="status" className="p-3 text-sm text-amber-800">Cannot refresh the queue. {queue ? 'Showing the last update. ' : ''}Retrying automatically.</p>}
        {removalError && <p role="alert" className="p-3 text-sm text-red-700">{removalError}</p>}
        {!queue && !error && <p role="status" className="p-3 text-sm text-stone-600">Loading jobs...</p>}
        {queue && <>
          {!queue.active.length && <p className="p-3 text-sm text-stone-600">No jobs queued. Queue a prepared application to add it here.</p>}
          <ul>{queue.active.map(job => renderJob(job, job.status === 'READY' ? ++position : undefined))}</ul>
        </>}
      </div>
    </section>}
    </div>
  </div>;
}
