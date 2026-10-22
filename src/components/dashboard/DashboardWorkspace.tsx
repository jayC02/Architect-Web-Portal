import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronRight, CircleAlert, FileCheck2, FolderKanban, Plus, Search, X, Zap } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type NextAction = { label: string; href?: string; tone?: string };
type Project = {
  id: string; name: string; stage: string; clientName?: string | null; siteSummary: string;
  documentReviewCount: number; readyAutomationJobCount: number;
  nextDeadline?: { title: string; dueDate: string } | null; nextAction?: NextAction;
};
type Attention = { id: string; type: string; projectName: string; reason: string; href: string; tone: string; date?: string };
type Deadline = { id: string; title: string; dueDate: string; status: string; project?: { id: string; name: string } | null };
type PipelineStage = { key: string; label: string; count: number; href: string };
type Summary = {
  activeProjects: number; upcomingDeadlineCount: number; documentsNeedingReview: number; automationJobsReady: number;
  planningActionCount: number; warrantActionCount: number;
  activeProjectSummaries: Project[]; needsAttention: Attention[]; upcomingDeadlines: Deadline[]; pipeline: PipelineStage[];
  documentOverview: { total: number; reviewed: number; needsReview: number };
};
type Props = { initialRange?: number };

const phases = [
  { label: 'Lead', key: 'lead', color: '#8b98ab', background: '#eef1f5' },
  { label: 'Documents', key: 'documents', color: '#9b83c1', background: '#f1edf8' },
  { label: 'Planning', key: 'planning', color: '#6c86c6', background: '#ecf1fb' },
  { label: 'Building warrant', key: 'warrant', color: '#488b85', background: '#e9f3f0' },
  { label: 'Complete', key: 'complete', color: '#7c9d70', background: '#edf3e9' },
];
const phaseIndex = (stage: string) => stage === 'SURVEY' || stage === 'DESIGN' ? 1 : stage === 'PLANNING' ? 2 : stage === 'BUILDING_WARRANT' || stage === 'CONSTRUCTION' ? 3 : stage === 'COMPLETION' ? 4 : 0;
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase());
const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/London' }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat('en-GB').format(value);
const needsAttention = (project: Project) => project.documentReviewCount > 0 || project.readyAutomationJobCount > 0 || ['danger', 'warning'].includes(project.nextAction?.tone ?? '');

function SummaryStrip({ data }: { data: Summary }) {
  const metrics = [
    { label: 'Active projects', value: data.activeProjects, detail: 'Across your practice', icon: FolderKanban, href: '/projects', tone: 'blue' },
    { label: 'Upcoming deadlines', value: data.upcomingDeadlineCount, detail: 'Including overdue items', icon: CalendarDays, href: '/deadlines', tone: 'violet' },
    { label: 'Documents to review', value: data.documentsNeedingReview, detail: 'Ready for a closer look', icon: FileCheck2, href: '/projects', tone: 'amber' },
    { label: 'Automation ready', value: data.automationJobsReady, detail: 'Prepared and waiting', icon: Zap, href: '/projects', tone: 'green' },
  ];
  return <dl className="practice-summary">{metrics.map(({ label, value, detail, icon: Icon, href, tone }) => <div key={label} className={`practice-metric metric-${tone}`}><dt><Icon size={16} strokeWidth={1.7} aria-hidden="true" />{label}</dt><dd><a href={href}>{number(value)}<ArrowUpRight size={17} aria-hidden="true" /></a></dd><p>{detail}</p></div>)}</dl>;
}

function ProjectPipeline({ stages }: { stages: PipelineStage[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return <section className="practice-pipeline" aria-labelledby="pipeline-heading"><div className="practice-section-heading"><h2 id="pipeline-heading">Project pipeline</h2><span>{total ? `${number(total)} projects across all stages` : 'No projects yet'}</span></div><div className="practice-pipeline-track" aria-hidden="true">{stages.filter(stage => stage.count > 0).map(stage => <span key={stage.key} style={{ flex: stage.count, background: phases.find(phase => phase.key === stage.key)?.color }} />)}</div><div className="practice-pipeline-legend">{phases.map(phase => { const stage = stages.find(item => item.key === phase.key); return <a key={phase.key} href={stage?.href ?? '/projects'} className="practice-phase-key"><span className="practice-phase-dot" style={{ background: phase.color }} aria-hidden="true" /><span>{phase.label}</span><strong>{number(stage?.count ?? 0)}</strong></a>; })}</div></section>;
}

function ProjectRegister({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const searchId = useId();
  const attentionCount = projects.filter(needsAttention).length;
  const visible = projects.filter(project => (filter === 'all' || needsAttention(project)) && `${project.name} ${project.siteSummary} ${project.clientName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="practice-register" aria-labelledby="projects-heading"><div className="practice-register-heading"><div><h2 id="projects-heading">Active projects <span className="practice-count">{projects.length}</span></h2><p>Recently updated across your practice</p></div><a href="/projects" className="practice-text-link">All projects <ArrowUpRight size={15} aria-hidden="true" /></a></div><div className="practice-register-tools"><div className="practice-filters" role="group" aria-label="Filter shown projects"><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All projects</button><button type="button" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention <span>{attentionCount}</span></button></div><div className="practice-search"><Search size={16} aria-hidden="true" /><label htmlFor={searchId} className="sr-only">Search shown projects</label><input id={searchId} type="search" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear project search" onClick={() => setQuery('')}><X size={14} aria-hidden="true" /></button>}</div></div>
    <div className="practice-results-status sr-only" role="status">{visible.length} projects shown</div>
    {visible.length > 0 ? <table className="practice-project-table"><caption className="sr-only">Recently updated active projects, their current stage and next action</caption><thead><tr><th scope="col">Project</th><th scope="col">Current stage</th><th scope="col">Next action</th></tr></thead><tbody>{visible.map(project => { const index = phaseIndex(project.stage); const phase = phases[index]; return <tr key={project.id}><td className="practice-project-identity"><a href={`/projects/${project.id}`} className="practice-project-name">{project.name}</a><span>{project.siteSummary}</span>{project.clientName && <span className="practice-project-client">{project.clientName}</span>}</td><td className="practice-project-stage"><span className={`practice-stage-badge phase-${phase.key}`}>{human(project.stage)}</span><span className="practice-stage-track" aria-label={`${phase.label}, stage ${index + 1} of 5`}>{phases.map((step, stepIndex) => <span key={step.key} style={{ background: stepIndex <= index ? phase.color : '#e9edf3' }} />)}</span></td><td className="practice-project-action"><a href={project.nextAction?.href ?? `/projects/${project.id}`} className={project.nextAction?.tone === 'danger' ? 'practice-action-danger' : ''}>{project.nextAction?.label ?? 'Open project'}<ChevronRight size={15} aria-hidden="true" /></a>{project.nextDeadline && <span><CalendarDays size={12} aria-hidden="true" /><time dateTime={project.nextDeadline.dueDate}>{formatDate(project.nextDeadline.dueDate)}</time></span>}</td></tr>; })}</tbody></table> : <div className="practice-empty"><FolderKanban size={28} strokeWidth={1.4} aria-hidden="true" /><h3>{projects.length ? 'No matching projects' : 'Your next project starts here'}</h3><p>{projects.length ? 'Try another search or show all recently updated projects.' : 'Create a project or start an application to bring your practice into view.'}</p>{projects.length ? <button type="button" className="practice-button-secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button> : <a href="/projects/new" className="practice-button-primary"><Plus size={16} aria-hidden="true" />Create project</a>}</div>}
    {projects.length > 0 && <div className="practice-register-footer"><span>Showing {visible.length} of {projects.length} recently updated projects</span><a href="/projects">Open project directory <ArrowRight size={14} aria-hidden="true" /></a></div>}
  </section>;
}

function AttentionList({ items, planningActions, warrantActions }: { items: Attention[]; planningActions: number; warrantActions: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 3);
  return <section className="practice-attention" aria-labelledby="attention-heading"><div className="practice-section-heading"><h2 id="attention-heading">Needs attention</h2><span className="practice-attention-count">{items.length}</span></div>{items.length ? <><div className="practice-attention-list">{shown.map(item => <a key={item.id} href={item.href} className={`practice-attention-item attention-${item.tone}`}><span className="practice-attention-symbol">{item.tone === 'ready' ? <CheckCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}</span><span><span className="practice-attention-type">{item.type}</span><strong>{item.projectName}</strong><span className="practice-attention-reason">{item.reason}</span></span><ChevronRight size={15} aria-hidden="true" /></a>)}</div>{items.length > 3 && <button type="button" className="practice-attention-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer items' : `View all ${items.length} items`}<ArrowRight size={14} aria-hidden="true" /></button>}</> : <div className="practice-clear"><Check size={19} aria-hidden="true" /><strong>All clear for now</strong><p>No urgent practice items found.</p></div>}<dl className="practice-workload" aria-label="Application actions"><div><dt><a href="/projects">Planning actions</a></dt><dd>{number(planningActions)}</dd></div><div><dt><a href="/projects">Warrant actions</a></dt><dd>{number(warrantActions)}</dd></div></dl></section>;
}

function Deadlines({ deadlines, range, onRangeChange, loading }: { deadlines: Deadline[]; range: number; onRangeChange: (range: number) => void; loading: boolean }) {
  const rangeId = useId();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <section className="practice-deadlines" aria-labelledby="deadlines-heading" aria-busy={loading}><div className="practice-section-heading"><h2 id="deadlines-heading">Upcoming deadlines</h2><a href="/deadlines" aria-label="View all deadlines"><ArrowUpRight size={17} aria-hidden="true" /></a></div><label htmlFor={rangeId} className="sr-only">Deadline date range</label><select id={rangeId} className="practice-range" value={range} onChange={event => onRangeChange(Number(event.target.value))}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option></select><div className="practice-deadline-list">{deadlines.slice(0, 4).map(deadline => { const overdue = deadline.status === 'OVERDUE' || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(deadline.dueDate)) < today; return <a key={deadline.id} href={deadline.project?.id ? `/deadlines?projectId=${deadline.project.id}` : '/deadlines'} className={`practice-deadline-item${overdue ? ' is-overdue' : ''}`}><time className="practice-date-tile" dateTime={deadline.dueDate}><span>{formatDate(deadline.dueDate, { month: 'short' })}</span><strong>{formatDate(deadline.dueDate, { day: 'numeric' })}</strong></time><span className="practice-deadline-copy"><strong>{deadline.title}</strong><span>{deadline.project?.name ?? 'Practice deadline'}</span>{overdue && <span className="practice-overdue-label">Overdue</span>}</span></a>; })}{!deadlines.length && <p className="practice-no-deadlines">No deadlines in this period. <a href="/deadlines">Manage deadlines</a></p>}</div></section>;
}

export default function DashboardWorkspace({ initialRange = 14 }: Props) {
  const [range, setRange] = useState(initialRange);
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
    window.addEventListener('portal:mutation-success', mutation);
    return () => { cancelled = true; active?.abort(); window.removeEventListener('portal:mutation-success', mutation); };
  }, [range, retry]);
  const changeRange = useCallback((value: number) => {
    setRange(value);
    const url = new URL(window.location.href); url.searchParams.set('deadlineRange', String(value)); window.history.replaceState(null, '', url);
  }, []);
  return <div className="practice-workspace"><div className="practice-page-heading"><div><h1>Practice overview</h1><p>Projects, applications and deadlines, in one place.</p></div><div className="practice-heading-actions"><a href="/projects/new" className="practice-create-project">Create project</a><a href="/applications/new" className="practice-button-primary"><Plus size={17} aria-hidden="true" />New application</a></div></div><div className="practice-date-line"><CalendarDays size={14} aria-hidden="true" /><span>{dateLabel || 'Your practice at a glance'}</span></div>
    {error && <div className="practice-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><div><strong>{data ? 'The latest changes could not be loaded.' : 'Your practice overview could not be loaded.'}</strong><p>{error}{data ? ' The previous data is still shown.' : ''}</p></div><button type="button" onClick={() => setRetry(value => value + 1)} disabled={loading}>{loading ? 'Retrying…' : 'Try again'}</button></div>}
    {!data && loading && <div className="practice-loading" role="status"><span>Loading your practice overview…</span><div className="practice-skeleton-summary" /><div className="practice-skeleton-content" /></div>}
    {data && <><SummaryStrip data={data} /><div className="practice-content-grid"><div className="practice-primary-column"><ProjectPipeline stages={data.pipeline ?? []} /><ProjectRegister projects={data.activeProjectSummaries ?? []} /><section className="practice-document-status" aria-labelledby="documents-heading"><span className="practice-document-icon"><FileCheck2 size={21} strokeWidth={1.6} aria-hidden="true" /></span><div><h2 id="documents-heading">Document review</h2><p>{number(data.documentOverview?.reviewed ?? 0)} of {number(data.documentOverview?.total ?? 0)} documents reviewed{data.documentsNeedingReview > 0 ? ` · ${number(data.documentsNeedingReview)} still need a look` : ''}</p></div><a href="/projects" className="practice-text-link">View documents <ArrowUpRight size={15} aria-hidden="true" /></a></section></div><aside className="practice-secondary-column" aria-label="Practice actions and deadlines"><AttentionList items={data.needsAttention ?? []} planningActions={data.planningActionCount ?? 0} warrantActions={data.warrantActionCount ?? 0} /><Deadlines deadlines={data.upcomingDeadlines ?? []} range={range} onRangeChange={changeRange} loading={loading} /></aside></div></>}
  </div>;
}
