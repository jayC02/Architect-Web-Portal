import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, FileCheck2, FolderKanban, PoundSterling, Plus, ReceiptText, Search, Send, X } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import { dashboardDayKey, dashboardPhase } from '@/lib/dashboard/overview';
import { Badge, type BadgeColor } from '@/components/tailadmin/Badge';
import { ApprovalGauge, MetricCard, StatisticsChart, SubmissionsChart, formatMoney, moneyIn, type DashboardFinance } from '@/components/dashboard/DashboardCharts';
import type { DashboardActivity } from '@/lib/dashboard/activity';

// Layout, cards, table and badges follow TailAdmin's dashboard (MIT):
// https://github.com/TailAdmin/free-react-tailwind-admin-dashboard

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
  activity?: DashboardActivity;
  finance?: DashboardFinance | null;
};
type Props = { initialRange?: number; initialPhase?: string };

const phases = [
  { label: 'Lead', key: 'lead', bar: 'bg-gray-400', badge: 'gray' as BadgeColor },
  { label: 'Documents', key: 'documents', bar: 'bg-sky-500', badge: 'info' as BadgeColor },
  { label: 'Planning', key: 'planning', bar: 'bg-brand-500', badge: 'primary' as BadgeColor },
  { label: 'Building warrant', key: 'warrant', bar: 'bg-amber-500', badge: 'warning' as BadgeColor },
  { label: 'Completion', key: 'complete', bar: 'bg-green-500', badge: 'success' as BadgeColor },
];
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase());
const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/London' }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat('en-GB').format(value);
// Some reasons carry raw status codes such as FURTHER_INFORMATION_REQUESTED; show them as words.
const readable = (text: string) => text.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, code => human(code)).replace(/ - /g, ', ');

const card = 'rounded-2xl border border-gray-200 bg-white';
const cardTitle = 'text-lg font-semibold text-gray-800';
const outlineButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600';
const tab = (active: boolean) => `inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-white text-gray-900 shadow-theme-xs' : 'text-gray-500 hover:text-gray-900'}`;

const percentChange = (current: number, previous: number) => previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

function Metrics({ data }: { data: Summary }) {
  const activity = data.activity;
  const finance = data.finance;
  const today = dashboardDayKey(new Date());
  const overdueDeadlines = data.upcomingDeadlines.filter(deadline => dashboardDayKey(deadline.dueDate) < today).length;
  const waiting = data.activeProjectSummaries.filter(project => project.needsAttention).length;
  const cards = [
    <MetricCard key="projects" icon={<FolderKanban />} title="Active projects" value={number(data.activeProjects)} href="#active-projects"
      note={waiting ? <Badge color="warning">{waiting} need you</Badge> : <Badge color="success">All on track</Badge>} />,
    <MetricCard key="submitted" icon={<Send />} title="Submitted this month" value={number(activity?.submittedThisMonth ?? 0)}
      change={activity ? percentChange(activity.submittedThisMonth, activity.submittedLastMonth) : null}
      note={<Badge color="gray">{activity?.submittedLastMonth ?? 0} last month</Badge>} />,
  ];
  if (finance) {
    const invoiced = moneyIn(finance, finance.metrics.invoicedThisMonth);
    const previous = finance.monthly.length > 1 ? moneyIn(finance, finance.monthly[finance.monthly.length - 2].invoiced).value : 0;
    const outstanding = moneyIn(finance, finance.metrics.outstanding);
    const overdue = moneyIn(finance, finance.metrics.overdue);
    cards.push(
      <MetricCard key="invoiced" icon={<ReceiptText />} title="Invoiced this month" value={formatMoney(invoiced.value, invoiced.currency)} href="/finance"
        change={percentChange(invoiced.value, previous)} note={<Badge color="gray">From Xero</Badge>} />,
      <MetricCard key="outstanding" icon={<PoundSterling />} title="Outstanding" value={formatMoney(outstanding.value, outstanding.currency)} href="/finance"
        note={overdue.value > 0 ? <Badge color="error">{formatMoney(overdue.value, overdue.currency, true)} overdue</Badge> : <Badge color="success">None overdue</Badge>} />,
    );
  } else {
    cards.push(
      <MetricCard key="deadlines" icon={<CalendarDays />} title={`Deadlines, next ${data.deadlineRange} days`} value={number(data.upcomingDeadlineCount)} href="#upcoming-deadlines"
        note={overdueDeadlines ? <Badge color="error">{overdueDeadlines} overdue</Badge> : <Badge color="success">None overdue</Badge>} />,
      <MetricCard key="documents" icon={<FileCheck2 />} title="Documents to review" value={number(data.documentsNeedingReview)} href="#document-review"
        note={<Badge color={data.documentsNeedingReview ? 'warning' : 'success'}>{data.documentOverview.reviewed} of {data.documentOverview.total} approved</Badge>} />,
    );
  }
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">{cards}</div>;
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
  return <section id="active-projects" className={`${card} overflow-hidden px-4 pb-3 pt-4 sm:px-6`} aria-labelledby="projects-heading">
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 id="projects-heading" className={cardTitle}>{phase === 'complete' ? 'Completion projects' : 'Active projects'}</h3>
        <p className="mt-1 text-sm text-gray-500">Current stage and the next step for each project.</p>
      </div>
      <a href="/projects" className={outlineButton}>See all <ArrowUpRight size={16} aria-hidden="true" /></a>
    </div>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex w-fit items-center gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Filter active projects">
        <button type="button" aria-pressed={filter === 'all'} className={tab(filter === 'all')} onClick={() => { setFilter('all'); onPhaseChange('all'); }}>All active</button>
        <button type="button" aria-pressed={filter === 'attention'} className={tab(filter === 'attention')} onClick={() => setFilter('attention')}>Needs attention <Badge size="sm" color="warning">{attentionCount}</Badge></button>
      </div>
      <label className="sr-only" htmlFor={`${searchId}-stage`}>Stage</label>
      <select id={`${searchId}-stage`} value={phase} onChange={event => onPhaseChange(event.target.value)} className="h-11 rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-none focus:ring-[3px] focus:ring-brand-500/10">
        <option value="all">All stages</option>
        {phases.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <div className="relative flex-1">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">Search active projects</label>
        <input id={searchId} type="search" placeholder="Search projects, clients or references" value={query} onChange={event => setQuery(event.target.value)}
          className="h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pl-11 pr-10 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-[3px] focus:ring-brand-500/10" />
        {query && <button type="button" aria-label="Clear project search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={() => setQuery('')}><X size={16} aria-hidden="true" /></button>}
      </div>
    </div>
    {phase !== 'all' && <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
      <Badge color={phases.find(item => item.key === phase)?.badge ?? 'gray'}>Stage: {phases.find(item => item.key === phase)?.label}</Badge>
      <button type="button" className="inline-flex items-center gap-1 font-medium text-gray-500 hover:text-gray-800" onClick={() => onPhaseChange('all')}>Clear <X size={14} aria-hidden="true" /></button>
    </div>}
    <p className="sr-only" role="status">{visible.length} matching projects. Page {currentPage} of {pages}.</p>
    {shown.length ? <div className="max-w-full overflow-x-auto">
      <table className="min-w-full">
        <caption className="sr-only">Projects, their current stage and next action</caption>
        <thead className="border-y border-gray-100">
          <tr>
            <th scope="col" className="py-3 pr-4 text-start text-xs font-medium text-gray-500">Project</th>
            <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-gray-500">Stage</th>
            <th scope="col" className="py-3 pl-4 text-start text-xs font-medium text-gray-500">Next action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {shown.map(project => {
            const key = dashboardPhase(project.stage, project.status);
            const stage = phases.find(item => item.key === key);
            const danger = project.nextAction?.tone === 'danger';
            return <tr key={project.id}>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600">{project.internalReference ? project.internalReference.slice(-3) : project.name.slice(0, 2).toUpperCase()}</div>
                  <div className="min-w-0">
                    <a href={`/projects/${project.id}`} className="block truncate text-sm font-medium text-gray-800 hover:text-brand-500">{project.name}</a>
                    <span className="block truncate text-xs text-gray-500">{[project.internalReference, project.clientName ?? project.siteSummary].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge size="sm" color={project.status === 'ON_HOLD' ? 'gray' : stage?.badge ?? 'gray'}>{project.status === 'COMPLETED' ? 'Completed' : human(project.stage)}{project.status === 'ON_HOLD' ? ', on hold' : ''}</Badge>
              </td>
              <td className="py-3 pl-4">
                <a href={project.nextAction?.href ?? `/projects/${project.id}`} className={`inline-flex items-center gap-1 text-sm font-medium ${danger ? 'text-red-600 hover:text-red-700' : 'text-gray-700 hover:text-brand-500'}`}>{project.nextAction?.label ?? 'Open project'}<ChevronRight size={15} aria-hidden="true" /></a>
                {project.nextDeadline && project.status !== 'COMPLETED' && <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"><CalendarDays size={12} aria-hidden="true" /><time dateTime={project.nextDeadline.dueDate}>Due {formatDate(project.nextDeadline.dueDate)}</time></span>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-600"><FolderKanban size={22} aria-hidden="true" /></div>
      <h4 className="mt-1 text-base font-semibold text-gray-800">{projects.length || completedProjects.length ? 'No matching projects' : 'Start your first application'}</h4>
      <p className="text-sm text-gray-500">{projects.length || completedProjects.length ? 'Try another search or clear the filters.' : 'Upload project documents to prepare an application with AI.'}</p>
      {projects.length || completedProjects.length ? <button type="button" className={`${outlineButton} mt-2`} onClick={clear}>Clear filters</button> : <div className="mt-2 flex items-center gap-3"><a href="/applications/new" className={primaryButton}><Plus size={16} aria-hidden="true" />New application</a><a href="/projects/new" className={outlineButton}>Manual project</a></div>}
    </div>}
    {visible.length > 0 && <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-sm text-gray-500">
      <span>Showing {(currentPage - 1) * 6 + 1}–{Math.min(currentPage * 6, visible.length)} of {visible.length}</span>
      {pages > 1 ? <div className="flex items-center gap-2">
        <button type="button" className={`${outlineButton} px-2.5 py-2`} disabled={currentPage === 1} aria-label="Previous project page" onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <span className="tabular-nums">{currentPage} / {pages}</span>
        <button type="button" className={`${outlineButton} px-2.5 py-2`} disabled={currentPage === pages} aria-label="Next project page" onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div> : <a href="/projects" className="inline-flex items-center gap-1 font-medium text-gray-700 hover:text-brand-500">Project directory <ArrowRight size={14} aria-hidden="true" /></a>}
    </div>}
  </section>;
}

const attentionColor = (item: Attention): BadgeColor => item.tone === 'danger' ? 'error' : item.tone === 'warning' ? 'warning' : item.tone === 'ready' ? 'success' : 'gray';

function AttentionList({ items, planningActions, warrantActions }: { items: Attention[]; planningActions: number; warrantActions: number }) {
  const [expanded, setExpanded] = useState(false);
  return <section className={`${card} p-5 md:p-6`} aria-labelledby="attention-heading">
    <div className="flex items-center justify-between gap-3"><h3 id="attention-heading" className={cardTitle}>Needs attention</h3><Badge color={items.length ? 'warning' : 'success'}>{items.length} open</Badge></div>
    {items.length ? <>
      <ul className="mt-4 divide-y divide-gray-100">{(expanded ? items : items.slice(0, 4)).map(item => <li key={item.id}>
        <a href={item.href} className="group flex items-start gap-3 py-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.tone === 'danger' ? 'bg-red-50 text-red-600' : item.tone === 'ready' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{item.tone === 'ready' ? <CheckCheck size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-800 group-hover:text-brand-500">{item.projectName}</span>
            <span className="block truncate text-xs text-gray-500">{readable(item.reason)}</span>
            <Badge size="sm" color={attentionColor(item)} className="mt-1.5">{item.type}</Badge>
          </span>
          <ChevronRight size={16} className="mt-2 shrink-0 text-gray-400 group-hover:text-gray-700" aria-hidden="true" />
        </a>
      </li>)}</ul>
      {items.length > 4 && <button type="button" className={`${outlineButton} mt-2 w-full`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `View all ${items.length} items`}</button>}
    </> : <div className="mt-4 flex items-center gap-3 rounded-xl bg-green-50 p-4 text-sm text-green-700"><CheckCheck size={18} aria-hidden="true" /><span><strong className="font-semibold">All clear for now.</strong> No items need your attention.</span></div>}
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4" aria-label="Application actions">
      <div className="rounded-xl bg-gray-50 px-4 py-3"><dt className="text-xs text-gray-500">Planning actions</dt><dd className="mt-1 text-title-sm font-semibold text-gray-800">{number(planningActions)}</dd></div>
      <div className="rounded-xl bg-gray-50 px-4 py-3"><dt className="text-xs text-gray-500">Warrant actions</dt><dd className="mt-1 text-title-sm font-semibold text-gray-800">{number(warrantActions)}</dd></div>
    </dl>
  </section>;
}

function Deadlines({ deadlines, range, onRangeChange, loading, currentRange }: { deadlines: Deadline[]; range: number; onRangeChange: (range: number) => void; loading: boolean; currentRange: number }) {
  const [expanded, setExpanded] = useState(false);
  const rangeId = useId();
  const today = dashboardDayKey(new Date());
  return <section id="upcoming-deadlines" className={`${card} p-5 md:p-6`} aria-labelledby="deadlines-heading" aria-busy={loading}>
    <div className="flex items-center justify-between gap-3">
      <h3 id="deadlines-heading" className={cardTitle}>Upcoming deadlines</h3>
      <label htmlFor={rangeId} className="sr-only">Deadline date range</label>
      <select id={rangeId} className="h-9 rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-none focus:ring-[3px] focus:ring-brand-500/10" value={range} onChange={event => { setExpanded(false); onRangeChange(Number(event.target.value)); }}>
        <option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option>
      </select>
    </div>
    <p className="mt-1 text-sm text-gray-500">Includes all overdue deadlines.{currentRange !== range ? ` Showing the last loaded ${currentRange}-day range.` : ''}</p>
    <ul className="mt-4 divide-y divide-gray-100">
      {(expanded ? deadlines : deadlines.slice(0, 4)).map(deadline => {
        const overdue = dashboardDayKey(deadline.dueDate) < today;
        return <li key={deadline.id}><a href={deadline.project?.id ? `/projects/${deadline.project.id}#deadlines` : '/deadlines'} className="group flex items-center gap-3 py-3">
          <time dateTime={deadline.dueDate} className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl ${overdue ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-700'}`}>
            <span className="text-[11px] font-medium uppercase leading-none">{formatDate(deadline.dueDate, { month: 'short' })}</span>
            <span className="mt-0.5 text-lg font-semibold leading-none">{formatDate(deadline.dueDate, { day: 'numeric' })}</span>
          </time>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-800 group-hover:text-brand-500">{deadline.title}</span>
            <span className="block truncate text-xs text-gray-500">{deadline.project?.name ?? 'General deadline'}</span>
          </span>
          {overdue && <Badge size="sm" color="error">Overdue</Badge>}
        </a></li>;
      })}
    </ul>
    {!deadlines.length && <p className="mt-4 text-sm text-gray-500">No deadlines in this period. <a href="/deadlines" className="font-medium text-brand-500 hover:underline">Manage deadlines</a></p>}
    <div className="mt-2 flex gap-3">
      {deadlines.length > 4 && <button type="button" className={`${outlineButton} flex-1`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `View all ${deadlines.length}`}</button>}
      <a href="/deadlines" className={`${outlineButton} flex-1`}>Manage deadlines <ArrowUpRight size={15} aria-hidden="true" /></a>
    </div>
  </section>;
}

function DocumentReview({ overview }: { overview: Summary['documentOverview'] }) {
  const percent = overview.total ? Math.round((overview.reviewed / overview.total) * 100) : 0;
  return <section id="document-review" className={`${card} p-5 md:p-6`} aria-labelledby="documents-heading">
    <div className="flex items-center justify-between gap-3"><h3 id="documents-heading" className={cardTitle}>Document review</h3><Badge color={overview.needsReview ? 'warning' : 'success'}>{overview.needsReview ? `${overview.needsReview} to review` : 'Up to date'}</Badge></div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <p className="text-sm text-gray-500"><span className="block text-title-md font-bold text-gray-800">{number(overview.reviewed)}</span>approved of {number(overview.total)} documents</p>
      <span className="text-sm font-medium text-gray-700">{percent}%</span>
    </div>
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} /></div>
    {(overview.statuses ?? []).length > 0 && <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{(overview.statuses ?? []).map(item => <div key={item.status} className="rounded-xl bg-gray-50 px-4 py-3"><dt className="text-xs text-gray-500">{human(item.status)}</dt><dd className="mt-1 text-base font-semibold text-gray-800">{number(item.count)}</dd></div>)}</dl>}
    {overview.projects?.length ? <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">{overview.projects.map(project => <li key={project.id}><a href={`/projects/${project.id}/files`} className="group flex items-center justify-between gap-3 py-3 text-sm"><span className="truncate font-medium text-gray-800 group-hover:text-brand-500">{project.name}</span><span className="flex items-center gap-2"><Badge size="sm" color="warning">{project.count} to review</Badge><ChevronRight size={15} className="text-gray-400" aria-hidden="true" /></span></a></li>)}</ul>
      : <p className="mt-4 text-sm text-gray-500">No documents are waiting for review.</p>}
  </section>;
}

function AutomationStatus({ overview }: { overview: NonNullable<Summary['automationOverview']> }) {
  const items = [
    { key: 'ready', label: 'Ready to queue', color: 'bg-brand-500' }, { key: 'queued', label: 'Queued', color: 'bg-sky-500' }, { key: 'running', label: 'Running', color: 'bg-green-500' },
    { key: 'connectionLost', label: 'Connection lost', color: 'bg-red-500' }, { key: 'needsAttention', label: 'Needs preparation or review', color: 'bg-amber-500' },
  ] as const;
  return <section id="automation-status" className={`${card} p-5 md:p-6`} aria-labelledby="automation-heading">
    <div className="flex items-center justify-between gap-3"><h3 id="automation-heading" className={cardTitle}>Automation status</h3><a href="/automation-jobs" className="text-sm font-medium text-brand-500 hover:underline">Manage</a></div>
    <dl className="mt-4 divide-y divide-gray-100">{items.map(item => <div key={item.key} className="flex items-center justify-between py-2.5 text-sm"><dt className="flex items-center gap-2.5 text-gray-500"><span className={`h-2 w-2 rounded-full ${item.color}`} aria-hidden="true" />{item.label}</dt><dd className="font-semibold tabular-nums text-gray-800">{number(overview[item.key])}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-gray-500">Current preparation per application. Agent availability is checked when queueing.</p>
  </section>;
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
  return <div className="ta-dashboard">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-title-md font-semibold text-gray-800">Overview</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-gray-500"><CalendarDays size={15} aria-hidden="true" />{dateLabel || 'Projects, applications and deadlines, in one place.'}</p>
      </div>
      <a href="/applications/new" className={primaryButton}><Plus size={17} aria-hidden="true" />New application</a>
    </div>
    {error && <div className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert"><CircleAlert size={20} aria-hidden="true" /><div className="min-w-0 flex-1"><strong className="font-semibold">{data ? 'The latest changes could not be loaded.' : 'Your overview could not be loaded.'}</strong><p className="mt-1 text-sm">{error}{data ? ' The previous data is still shown.' : ''}</p></div><button type="button" className={outlineButton} onClick={() => setRetry(value => value + 1)} disabled={loading}>{loading ? 'Retrying…' : 'Try again'}</button></div>}
    {!data && loading && <div role="status" className="grid gap-6"><span className="sr-only">Loading your overview…</span><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="h-40 animate-pulse rounded-2xl bg-gray-100" />)}</div><div className="h-96 animate-pulse rounded-2xl bg-gray-100" /></div>}
    {data && <div className="grid grid-cols-12 gap-4 md:gap-6">
      <div className="col-span-12 space-y-4 md:space-y-6 xl:col-span-7">
        <Metrics data={data} />
        {data.activity && <SubmissionsChart activity={data.activity} />}
      </div>
      <div className="col-span-12 xl:col-span-5">{data.activity && <ApprovalGauge activity={data.activity} />}</div>
      {data.activity && <div className="col-span-12"><StatisticsChart activity={data.activity} finance={data.finance ?? null} /></div>}
      <div className="col-span-12 xl:col-span-7 [&>section]:h-full">
        <ProjectRegister projects={data.activeProjectSummaries} completedProjects={data.completedProjectSummaries ?? []} phase={phase} onPhaseChange={changePhase} />
      </div>
      <aside className="col-span-12 xl:col-span-5 [&>section]:h-full" aria-label="Needs attention">
        <AttentionList items={data.needsAttention} planningActions={data.planningActionCount} warrantActions={data.warrantActionCount} />
      </aside>
      <div className="col-span-12 lg:col-span-6 xl:col-span-4 [&>section]:h-full"><Deadlines deadlines={data.upcomingDeadlines} range={range} onRangeChange={changeRange} loading={loading} currentRange={data.deadlineRange} /></div>
      <div className="col-span-12 lg:col-span-6 xl:col-span-4 [&>section]:h-full"><DocumentReview overview={data.documentOverview} /></div>
      <div className="col-span-12 xl:col-span-4 [&>section]:h-full"><AutomationStatus overview={data.automationOverview ?? { ready: data.automationJobsReady, queued: 0, running: 0, connectionLost: 0, needsAttention: 0 }} /></div>
    </div>}
  </div>;
}
