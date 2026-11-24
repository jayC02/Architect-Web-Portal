import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Plus } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import ProjectTimeline, { type TimelineFilter } from '@/components/dashboard/ProjectTimeline';
import { NeedsYou, NextDays, OnTrackRing, WithCouncil } from '@/components/dashboard/DashboardInsights';
import type { TimelineInput } from '@/lib/dashboard/timeline';

type Project = {
  id: string; name: string; stage: string; status: string; internalReference?: string | null;
  clientName?: string | null; siteSummary: string; needsAttention: boolean;
  documentReviewCount: number; readyAutomationJobCount: number;
  nextDeadline?: { title: string; dueDate: string } | null;
  nextAction?: { label: string; href?: string; tone?: string };
  timeline?: TimelineInput;
};
type Attention = { id: string; type: string; projectName: string; reason: string; href: string; tone: string; date?: string };
type Deadline = { id: string; title: string; dueDate: string; status: string; project?: { id: string; name: string } | null };
type PipelineStage = { key: string; label: string; count: number; href: string };
type Summary = {
  activeProjects: number; upcomingDeadlineCount: number; documentsNeedingReview: number; automationJobsReady: number;
  planningActionCount: number; warrantActionCount: number; deadlineRange: number; generatedAt?: string;
  activeProjectSummaries: Project[]; completedProjectSummaries?: Project[]; needsAttention: Attention[]; upcomingDeadlines: Deadline[]; pipeline: PipelineStage[];
  documentOverview: { total: number; reviewed: number; needsReview: number; statuses?: { status: string; count: number }[]; projects?: { id: string; name: string; count: number }[] };
  automationOverview?: { ready: number; queued: number; running: number; connectionLost: number; needsAttention: number };
};
type Props = { initialRange?: number; initialPhase?: string; userName?: string | null };

// Older links filter by project phase; map them onto the timeline's filters.
const filterFromPhase = (phase: string): TimelineFilter => phase === 'planning' ? 'planning' : phase === 'warrant' ? 'warrant' : phase === 'complete' ? 'completion' : 'all';
const formatDate = (value: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/London' }).format(value);
const greetingFor = (hour: number) => hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';


export default function DashboardWorkspace({ initialRange = 14, initialPhase = 'all', userName = null }: Props) {
  const [range, setRange] = useState(initialRange);
  const [filter, setFilter] = useState<TimelineFilter>(filterFromPhase(initialPhase));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [heading, setHeading] = useState({ date: '', greeting: 'Welcome back' });
  useEffect(() => {
    const now = new Date();
    const hour = Number(formatDate(now, { hour: 'numeric', hour12: false }));
    setHeading({ date: formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' }), greeting: greetingFor(hour) });
  }, []);
  useEffect(() => {
    let cancelled = false;
    let active: AbortController | null = null;
    const load = async () => {
      active?.abort();
      const controller = new AbortController(); active = controller;
      setLoading(true); setError('');
      try {
        const result = await apiRequest<Summary>(`/api/dashboard/summary?deadlineRange=${range}`, { signal: controller.signal });
        if (!cancelled && !controller.signal.aborted) setData(result);
      } catch (requestError) {
        if (!cancelled && !controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'The dashboard could not be loaded.');
      } finally { if (!cancelled && !controller.signal.aborted) setLoading(false); }
    };
    void load();
    const mutation = () => { void load(); };
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener('portal:mutation-success', mutation);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => { cancelled = true; active?.abort(); window.clearInterval(timer); window.removeEventListener('portal:mutation-success', mutation); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [range, retry]);
  const changeRange = useCallback((value: number) => {
    setRange(value);
    const url = new URL(window.location.href); url.searchParams.set('deadlineRange', String(value)); window.history.replaceState(null, '', url);
  }, []);
  // Filters chosen in the cards drive the timeline, and scroll it into view.
  const focusTimeline = useCallback((value: TimelineFilter) => {
    setFilter(value);
    document.getElementById('project-timeline')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, []);
  const firstName = userName?.trim().split(/\s+/)[0];
  const needsYouCount = data?.activeProjectSummaries.filter(project => project.needsAttention).length ?? 0;
  return <div className="practice-workspace dash">
    <header className="dash-hello">
      <div>
        <p className="dash-date">{heading.date || ' '}</p>
        <h1>{heading.greeting}{firstName ? `, ${firstName}` : ''}</h1>
        {data && <p className="dash-lede">{data.activeProjects} active project{data.activeProjects === 1 ? '' : 's'}{needsYouCount ? `, ${needsYouCount} waiting on you` : ', none waiting on you'}.</p>}
      </div>
      <a href="/applications/new" className="btn btn-primary gap-2"><Plus size={17} aria-hidden="true" />New application</a>
    </header>
    {error && <div className="practice-error" role="alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>{data ? 'The latest changes could not be loaded.' : 'Your overview could not be loaded.'}</strong><p>{error}{data ? ' The previous data is still shown.' : ''}</p></div><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)} disabled={loading}>{loading ? 'Retrying…' : 'Try again'}</button></div>}
    {!data && loading && <div className="practice-loading" role="status"><span>Loading your overview…</span><div className="practice-skeleton-summary" /><div className="practice-skeleton-content" /></div>}
    {data && <>
      <ProjectTimeline projects={data.activeProjectSummaries} filter={filter} onFilterChange={setFilter} />
      <div className="dash-insights">
        <OnTrackRing projects={data.activeProjectSummaries} onFilter={focusTimeline} />
        <WithCouncil projects={data.activeProjectSummaries} onFilter={focusTimeline} />
        <NextDays deadlines={data.upcomingDeadlines} projects={data.activeProjectSummaries} range={range} onRangeChange={changeRange} loading={loading} />
      </div>
      <NeedsYou items={data.needsAttention} />
    </>}
  </div>;
}
