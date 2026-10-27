import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, FileCheck2, FolderKanban, Plus, Search, X, Zap } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import { dashboardDayKey, dashboardPhase } from '@/lib/dashboard/overview';

type Project = {
  id: string; name: string; stage: string; status: string; internalReference?: string | null;
  clientName?: string | null; siteSummary: string; needsAttention: boolean;
  documentReviewCount: number; readyAutomationJobCount: number;
  nextDeadline?: { title: string; dueDate: string } | null;
  nextAction?: { label: string; href?: string; tone?: string };
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
type Props = { initialRange?: number; initialPhase?: string };

const phases = [
  { label: 'Lead', key: 'lead' }, { label: 'Documents', key: 'documents' },
  { label: 'Planning', key: 'planning' }, { label: 'Building warrant', key: 'warrant' },
  { label: 'Completion', key: 'complete' },
];
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase());
const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/London' }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat('en-GB').format(value);

function SummaryStrip({ data }: { data: Summary }) {
  const metrics = [
    { label: 'Active projects', value: data.activeProjects, detail: 'Across your practice', icon: FolderKanban, href: '#active-projects' },
    { label: 'Deadlines', value: data.upcomingDeadlineCount, detail: `Next ${data.deadlineRange} days + overdue`, icon: CalendarDays, href: '#upcoming-deadlines' },
    { label: 'Documents to review', value: data.documentsNeedingReview, detail: 'Awaiting classification review', icon: FileCheck2, href: '#document-review' },
    { label: 'Automation ready', value: data.automationJobsReady, detail: 'Prepared, awaiting queueing', icon: Zap, href: '#automation-status' },
  ];
  return <dl className="practice-summary panel rounded-lg">{metrics.map(({ label, value, detail, icon: Icon, href }) => <div key={label} className="practice-metric"><dt><Icon size={16} aria-hidden="true" />{label}</dt><dd><a href={href} aria-label={`${value} ${label.toLowerCase()}`}>{number(value)}<ArrowUpRight size={16} aria-hidden="true" /></a></dd><p>{detail}</p></div>)}</dl>;
}

function ProjectPipeline({ stages, phase, onPhaseChange }: { stages: PipelineStage[]; phase: string; onPhaseChange: (phase: string) => void }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return <section className="practice-pipeline panel rounded-lg" aria-labelledby="pipeline-heading">
    <div className="practice-section-heading"><h2 id="pipeline-heading">Project pipeline</h2><span>{number(total)} non-archived projects</span></div>
    <div className="practice-pipeline-track" aria-hidden="true">{stages.filter(stage => stage.count > 0).map(stage => <span key={stage.key} className={`phase-fill-${stage.key}`} style={{ flex: stage.count }} />)}</div>
    <div className="practice-pipeline-legend">{phases.map(item => <button key={item.key} type="button" aria-pressed={phase === item.key} onClick={() => onPhaseChange(phase === item.key ? 'all' : item.key)}><span className={`practice-phase-dot phase-fill-${item.key}`} aria-hidden="true" /><span>{item.label}</span><strong>{number(stages.find(stage => stage.key === item.key)?.count ?? 0)}</strong></button>)}</div>
  </section>;
}

function ProjectRegister({ projects, completedProjects, phase, onPhaseChange }: { projects: Project[]; completedProjects: Project[]; phase: string; onPhaseChange: (phase: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [page, setPage] = useState(1);
  const searchId = useId();
  const source = phase === 'complete' ? [...projects, ...completedProjects] : projects;
  const attentionCount = projects.filter(project => project.needsAttention).length;
  const visible = source.filter(project => (phase === 'all' || dashboardPhase(project.stage, project.status) === phase)
    && (filter === 'all' || project.needsAttention)
    && `${project.name} ${project.siteSummary} ${project.clientName ?? ''} ${project.internalReference ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / 6));
  const currentPage = Math.min(page, pages);
  const shown = visible.slice((currentPage - 1) * 6, currentPage * 6);
  useEffect(() => { setPage(1); }, [phase, query, filter]);
  const clear = () => { setQuery(''); setFilter('all'); onPhaseChange('all'); setPage(1); };
  return <section id="active-projects" className="practice-register panel rounded-lg" aria-labelledby="projects-heading">
    <div className="practice-register-heading"><div><h2 id="projects-heading">{phase === 'complete' ? 'Completion projects' : 'Active projects'} <span className="practice-count">{phase === 'complete' ? source.filter(project => dashboardPhase(project.stage, project.status) === phase).length : projects.length}</span></h2><p>Current stages and the next step for each project.</p></div><a href="/projects" className="practice-text-link">All projects <ArrowUpRight size={15} aria-hidden="true" /></a></div>
    <div className="practice-register-tools"><div className="practice-filters" role="group" aria-label="Filter active projects"><button type="button" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); onPhaseChange('all'); }}>All active</button><button type="button" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention <span>{attentionCount}</span></button></div><div className="practice-search"><Search size={16} aria-hidden="true" /><label htmlFor={searchId} className="sr-only">Search active projects</label><input id={searchId} className="field" type="search" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear project search" onClick={() => setQuery('')}><X size={16} aria-hidden="true" /></button>}</div></div>
    {phase !== 'all' && <div className="practice-active-filter"><span>Stage: {phases.find(item => item.key === phase)?.label}</span><button type="button" onClick={() => onPhaseChange('all')}>Clear stage filter <X size={14} aria-hidden="true" /></button></div>}
    <p className="sr-only" role="status">{visible.length} matching projects. Page {currentPage} of {pages}.</p>
    {shown.length ? <table className="practice-project-table"><caption className="sr-only">Projects, their current stage and next action</caption><thead className="table-head"><tr><th scope="col">Project</th><th scope="col">Current stage</th><th scope="col">Next action</th></tr></thead><tbody>{shown.map(project => {
      const key = dashboardPhase(project.stage, project.status);
      const index = phases.findIndex(item => item.key === key);
      return <tr key={project.id}><td className="table-cell practice-project-identity"><a href={`/projects/${project.id}`} className="practice-project-name">{project.name}</a><span>{project.siteSummary}</span>{project.clientName && <span>{project.clientName}</span>}</td><td className="table-cell practice-project-stage"><span className={`practice-stage-badge phase-${key}`}>{project.status === 'COMPLETED' ? 'Completed' : human(project.stage)}</span><span className="practice-stage-track" role="img" aria-label={`${project.status === 'COMPLETED' ? 'Completed' : human(project.stage)}, workflow stage ${index + 1} of 5`}>{phases.map((step, stepIndex) => <span key={step.key} className={stepIndex <= index ? `phase-fill-${key}` : ''} />)}</span>{project.status === 'ON_HOLD' && <span className="practice-on-hold">On hold</span>}</td><td className="table-cell practice-project-action"><a href={project.nextAction?.href ?? `/projects/${project.id}`} className={project.nextAction?.tone === 'danger' ? 'practice-action-danger' : ''}>{project.nextAction?.label ?? 'Open project'}<ChevronRight size={15} aria-hidden="true" /></a>{project.nextDeadline && project.status !== 'COMPLETED' && <span><CalendarDays size={13} aria-hidden="true" /><time dateTime={project.nextDeadline.dueDate}>{formatDate(project.nextDeadline.dueDate)}</time></span>}</td></tr>;
    })}</tbody></table> : <div className="practice-empty"><FolderKanban size={28} aria-hidden="true" /><h3>{projects.length || completedProjects.length ? 'No matching projects' : 'Your next project starts here'}</h3><p>{projects.length || completedProjects.length ? 'Try another search or clear the filters.' : 'Create a project or start an application to bring your practice into view.'}</p>{projects.length || completedProjects.length ? <button type="button" className="btn btn-secondary" onClick={clear}>Clear filters</button> : <a href="/projects/new" className="btn btn-primary"><Plus size={16} aria-hidden="true" />Create project</a>}</div>}
    {visible.length > 0 && <div className="practice-register-footer"><span>Showing {(currentPage - 1) * 6 + 1}–{Math.min(currentPage * 6, visible.length)} of {visible.length}</span>{pages > 1 ? <div className="practice-pagination"><button type="button" className="btn btn-secondary" disabled={currentPage === 1} aria-label="Previous project page" onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><span>{currentPage} / {pages}</span><button type="button" className="btn btn-secondary" disabled={currentPage === pages} aria-label="Next project page" onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div> : <a href="/projects" className="practice-text-link">Project directory <ArrowRight size={14} aria-hidden="true" /></a>}</div>}
  </section>;
}

function AttentionList({ items, planningActions, warrantActions }: { items: Attention[]; planningActions: number; warrantActions: number }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="practice-attention panel rounded-lg" aria-labelledby="attention-heading"><div className="practice-section-heading"><h2 id="attention-heading">Needs attention</h2><span className="practice-count">{items.length}</span></div>{items.length ? <><div className="practice-attention-list">{(expanded ? items : items.slice(0, 3)).map(item => <a key={item.id} href={item.href} className={`practice-attention-item attention-${item.tone}`}><span className="practice-attention-symbol">{item.tone === 'ready' ? <CheckCheck size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}</span><span><span className="practice-attention-type">{item.type}</span><strong>{item.projectName}</strong><span className="practice-attention-reason">{item.reason}</span></span><ChevronRight size={15} aria-hidden="true" /></a>)}</div>{items.length > 3 && <button type="button" className="practice-attention-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer items' : `View all ${items.length} items`}<ArrowRight size={14} aria-hidden="true" /></button>}</> : <div className="practice-clear"><Check size={20} aria-hidden="true" /><strong>All clear for now</strong><p>No practice items need your attention.</p></div>}<dl className="practice-workload" aria-label="Application actions"><div><dt>Planning actions</dt><dd>{number(planningActions)}</dd></div><div><dt>Warrant actions</dt><dd>{number(warrantActions)}</dd></div></dl></section>;
}

function Deadlines({ deadlines, range, onRangeChange, loading, currentRange }: { deadlines: Deadline[]; range: number; onRangeChange: (range: number) => void; loading: boolean; currentRange: number }) {
  const [expanded, setExpanded] = useState(false);
  const rangeId = useId();
  const today = dashboardDayKey(new Date());
  return <section id="upcoming-deadlines" className="practice-deadlines panel rounded-lg" aria-labelledby="deadlines-heading" aria-busy={loading}><div className="practice-section-heading"><h2 id="deadlines-heading">Upcoming deadlines</h2><a className="practice-icon-link" href="/deadlines" aria-label="View all deadlines"><ArrowUpRight size={18} aria-hidden="true" /></a></div><label htmlFor={rangeId} className="sr-only">Deadline date range</label><select id={rangeId} className="field practice-range" value={range} onChange={event => { setExpanded(false); onRangeChange(Number(event.target.value)); }}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option></select><p className="practice-deadline-note">Includes all overdue deadlines.{currentRange !== range ? ` Showing the last loaded ${currentRange}-day range.` : ''}</p><div className="practice-deadline-list">{(expanded ? deadlines : deadlines.slice(0, 4)).map(deadline => <a key={deadline.id} href={deadline.project?.id ? `/projects/${deadline.project.id}#deadlines` : '/deadlines'} className={`practice-deadline-item${dashboardDayKey(deadline.dueDate) < today ? ' is-overdue' : ''}`}><time className="practice-date-tile" dateTime={deadline.dueDate}><span>{formatDate(deadline.dueDate, { month: 'short' })}</span><strong>{formatDate(deadline.dueDate, { day: 'numeric' })}</strong></time><span className="practice-deadline-copy"><strong>{deadline.title}</strong><span>{deadline.project?.name ?? 'Practice deadline'}</span>{dashboardDayKey(deadline.dueDate) < today && <span className="practice-overdue-label">Overdue</span>}</span></a>)}{!deadlines.length && <p className="practice-no-deadlines">No deadlines in this period. <a href="/deadlines">Manage deadlines</a></p>}</div>{deadlines.length > 4 && <button type="button" className="practice-attention-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer deadlines' : `View all ${deadlines.length} deadlines`}</button>}</section>;
}

function DocumentReview({ overview }: { overview: Summary['documentOverview'] }) {
  return <section id="document-review" className="practice-documents panel rounded-lg" aria-labelledby="documents-heading"><div className="practice-section-heading"><h2 id="documents-heading">Document review</h2><FileCheck2 size={19} aria-hidden="true" /></div><p className="practice-document-total"><strong>{number(overview.reviewed)}</strong> approved of {number(overview.total)} documents</p><dl className="practice-document-statuses">{(overview.statuses ?? []).map(item => <div key={item.status}><dt>{human(item.status)}</dt><dd>{number(item.count)}</dd></div>)}</dl>{overview.projects?.length ? <details className="practice-review-projects"><summary>Review {overview.needsReview} document{overview.needsReview === 1 ? '' : 's'} by project</summary><ul>{overview.projects.map(project => <li key={project.id}><a href={`/projects/${project.id}/files`}><span>{project.name}</span><strong>{project.count}</strong><ChevronRight size={15} aria-hidden="true" /></a></li>)}</ul></details> : <p className="practice-muted">No documents are waiting for review.</p>}</section>;
}

function AutomationStatus({ overview }: { overview: NonNullable<Summary['automationOverview']> }) {
  const items = [{ key: 'ready', label: 'Ready to queue' }, { key: 'queued', label: 'Queued' }, { key: 'running', label: 'Running' }, { key: 'connectionLost', label: 'Connection lost' }, { key: 'needsAttention', label: 'Needs preparation or review' }] as const;
  return <section id="automation-status" className="practice-automation panel rounded-lg" aria-labelledby="automation-heading"><div className="practice-section-heading"><h2 id="automation-heading">Automation status</h2><Zap size={19} aria-hidden="true" /></div><dl>{items.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{number(overview[item.key])}</dd></div>)}</dl><p className="practice-muted">Current preparation per application. Agent availability is checked when queueing.</p><a href="/automation-jobs" className="practice-text-link">Manage automation <ArrowUpRight size={15} aria-hidden="true" /></a></section>;
}

export default function DashboardWorkspace({ initialRange = 14, initialPhase = 'all' }: Props) {
  const [range, setRange] = useState(initialRange);
  const [phase, setPhase] = useState(initialPhase);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [dateLabel, setDateLabel] = useState('');
  useEffect(() => { setDateLabel(formatDate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })); }, []);
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
  const changePhase = (value: string) => {
    setPhase(value);
    const url = new URL(window.location.href);
    if (value === 'all') url.searchParams.delete('projectPhase'); else url.searchParams.set('projectPhase', value);
    window.history.replaceState(null, '', url);
  };
  return <div className="practice-workspace"><div className="practice-page-heading"><div><h1 className="text-3xl font-semibold tracking-tight">Practice overview</h1><p>Projects, applications and deadlines, in one place.</p></div><a href="/projects/new" className="btn btn-secondary gap-2"><Plus size={17} aria-hidden="true" />Create project</a></div><div className="practice-date-line"><CalendarDays size={15} aria-hidden="true" /><span>{dateLabel || 'Your practice at a glance'}</span></div>
    {error && <div className="practice-error" role="alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>{data ? 'The latest changes could not be loaded.' : 'Your practice overview could not be loaded.'}</strong><p>{error}{data ? ' The previous data is still shown.' : ''}</p></div><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)} disabled={loading}>{loading ? 'Retrying…' : 'Try again'}</button></div>}
    {!data && loading && <div className="practice-loading" role="status"><span>Loading your practice overview…</span><div className="practice-skeleton-summary" /><div className="practice-skeleton-content" /></div>}
    {data && <><SummaryStrip data={data} /><div className="practice-content-grid"><div className="practice-primary-column"><ProjectPipeline stages={data.pipeline} phase={phase} onPhaseChange={changePhase} /><ProjectRegister projects={data.activeProjectSummaries} completedProjects={data.completedProjectSummaries ?? []} phase={phase} onPhaseChange={changePhase} /><DocumentReview overview={data.documentOverview} /></div><aside className="practice-secondary-column" aria-label="Practice actions and deadlines"><AttentionList items={data.needsAttention} planningActions={data.planningActionCount} warrantActions={data.warrantActionCount} /><Deadlines deadlines={data.upcomingDeadlines} range={range} onRangeChange={changeRange} loading={loading} currentRange={data.deadlineRange} /><AutomationStatus overview={data.automationOverview ?? { ready: data.automationJobsReady, queued: 0, running: 0, connectionLost: 0, needsAttention: 0 }} /></aside></div></>}
  </div>;
}
