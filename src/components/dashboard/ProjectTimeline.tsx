import { useEffect, useMemo, useState, type FC } from 'react';
import { Search } from 'lucide-react';
import { Gantt, Tooltip, Willow, type IApi, type ITask } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import { timelineDay, timelineWeeks, type TimelineApplication, type TimelineInput } from '@/lib/dashboard/timeline';

// The council journey is drawn with SVAR React Gantt (MIT): https://svar.dev/react/gantt/
// This component only turns projects into Gantt tasks and adds the filters around it.

export type TimelineProject = {
  id: string;
  name: string;
  internalReference?: string | null;
  clientName?: string | null;
  siteSummary: string;
  needsAttention: boolean;
  nextDeadline?: { title: string; dueDate: string } | null;
  nextAction?: { label: string; href?: string; tone?: string };
  timeline?: TimelineInput;
};

export type TimelineFilter = 'all' | 'planning' | 'warrant' | 'completion' | 'attention' | 'overdue';

type Props = {
  projects: TimelineProject[];
  filter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
};

type Phase = 'planning' | 'warrant' | 'completion';

const zooms = [
  { key: '6w', label: '6 weeks', before: 2, weeks: 6, cellWidth: 150 },
  { key: '3m', label: '3 months', before: 4, weeks: 13, cellWidth: 96 },
  { key: '6m', label: '6 months', before: 8, weeks: 26, cellWidth: 56 },
] as const;

const filters: { key: TimelineFilter; label: string }[] = [
  { key: 'all', label: 'All projects' },
  { key: 'planning', label: 'Planning' },
  { key: 'warrant', label: 'Building warrant' },
  { key: 'completion', label: 'Completion' },
  { key: 'attention', label: 'Needs you' },
];

const phaseName: Record<Phase, string> = { planning: 'Planning application', warrant: 'Building warrant', completion: 'Completion certificate' };
const phaseAnchor: Record<Phase, string> = { planning: 'planning', warrant: 'building-warrant', completion: 'completion-certificate' };
const refusedStatuses = new Set(['REFUSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']);
const CELL_HEIGHT = 44;
const SCALE_HEIGHT = 32;
const MAX_HEIGHT = 640;

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const dayOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Europe/London' });
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });

const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : null);
const isOverdue = (project: TimelineProject, now: number) => Boolean(project.nextDeadline && new Date(project.nextDeadline.dueDate).getTime() < now - timelineDay / 2);

type PhaseTask = ITask & { phase: Phase; projectId: string; status: string; detail: string };

// One Gantt bar per application: from when work started to its decision, or to the
// council's target date while it is still waiting. Progress is how much of that time has gone.
const applicationTask = (project: TimelineProject, phase: Phase, application: TimelineApplication, now: number): PhaseTask | null => {
  if (application.status === 'NOT_STARTED') return null;
  const start = time(application.createdAt) ?? now;
  const submitted = time(application.submissionDate);
  const decided = time(application.decisionDate);
  const target = time(application.targetDate);
  const refused = refusedStatuses.has(application.status);
  const end = Math.max(decided ?? Math.max(target ?? 0, now), start + timelineDay);
  const days = submitted ? Math.max(1, Math.round((now - submitted) / timelineDay)) : 0;
  const status = decided ? (refused ? 'Refused' : phase === 'planning' ? 'Approved' : 'Granted')
    : submitted ? `With the council, day ${days}` : 'Preparing';
  const detail = [
    `Started ${dayMonth.format(start)}`,
    submitted && `submitted ${dayMonth.format(submitted)}`,
    decided ? `${refused ? 'refused' : 'decided'} ${dayMonth.format(decided)}` : target && `${phase === 'warrant' ? 'response' : 'decision'} due ${dayMonth.format(target)}`,
  ].filter(Boolean).join(' · ');
  return {
    id: `${project.id}::${phase}`, parent: project.id, type: phase, phase, projectId: project.id,
    text: status, status, detail,
    start: new Date(start), end: new Date(end),
    progress: decided ? 100 : Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 100),
  };
};

const completionTask = (project: TimelineProject, warrant: NonNullable<TimelineInput['warrant']>, now: number): PhaseTask | null => {
  const state = warrant.completionCertificateStatus;
  if (!state || !['DRAFTING', 'SUBMITTED'].includes(state)) return null;
  const start = time(warrant.completionPreparedAt) ?? time(warrant.decisionDate) ?? now - timelineDay;
  const status = state === 'SUBMITTED' ? 'Awaiting acceptance' : 'Preparing';
  return {
    id: `${project.id}::completion`, parent: project.id, type: 'completion', phase: 'completion', projectId: project.id,
    text: status, status, detail: `Started ${dayMonth.format(start)}`,
    start: new Date(start), end: new Date(Math.max(now, start + timelineDay)), progress: 100,
  };
};

const projectTasks = (project: TimelineProject, now: number) => {
  const children = [
    project.timeline?.planning && applicationTask(project, 'planning', project.timeline.planning, now),
    project.timeline?.warrant && applicationTask(project, 'warrant', project.timeline.warrant, now),
    project.timeline?.warrant && completionTask(project, project.timeline.warrant, now),
  ].filter((task): task is PhaseTask => Boolean(task));
  const parent: ITask = children.length
    ? { id: project.id, text: '', type: 'summary', open: true, project }
    : { id: project.id, text: 'No application yet', type: 'task', unscheduled: true, project };
  return { parent, children };
};

const NameCell: FC<{ row: ITask }> = ({ row }) => {
  if (row.project) {
    const project = row.project as TimelineProject;
    return <span className="gt-name">
      {project.internalReference && <span className="gt-ref">{project.internalReference}</span>}
      <strong>{project.name}</strong>
      {project.needsAttention && <span className="gt-flag" title="Needs you" />}
    </span>;
  }
  const phase = row.phase as Phase;
  return <span className={`gt-phase gt-${phase}`}><i aria-hidden="true" />{phaseName[phase]}</span>;
};

const TipContent: FC<{ data: { task?: ITask } }> = ({ data }) => {
  const task = data.task;
  if (!task) return null;
  if (task.project) {
    const project = task.project as TimelineProject;
    return <div className="gt-tip"><strong>{project.name}</strong><span>{project.clientName ?? project.siteSummary}</span>{project.nextAction && <span>Next: {project.nextAction.label}</span>}</div>;
  }
  return <div className="gt-tip"><strong>{phaseName[task.phase as Phase]}: {task.status}</strong><span>{task.detail}</span><em>Click to open</em></div>;
};

export default function ProjectTimeline({ projects, filter, onFilterChange }: Props) {
  const [zoom, setZoom] = useState<(typeof zooms)[number]['key']>('3m');
  const [query, setQuery] = useState('');
  const [api, setApi] = useState<IApi>();
  const [mounted, setMounted] = useState(false);
  // On a phone the project column narrows so the bars stay in view.
  const [gridWidth, setGridWidth] = useState(300);
  useEffect(() => { setGridWidth(window.innerWidth < 640 ? 150 : 300); setMounted(true); }, []);
  const now = useMemo(() => Date.now(), []);
  const view = zooms.find(item => item.key === zoom) ?? zooms[1];
  const weeks = useMemo(() => timelineWeeks(now - view.before * 7 * timelineDay, view.weeks), [now, view]);

  const rows = useMemo(() => projects.map(project => ({ project, ...projectTasks(project, now) })), [projects, now]);
  const counts = useMemo(() => ({
    all: rows.length,
    planning: rows.filter(row => row.children.some(task => task.phase === 'planning')).length,
    warrant: rows.filter(row => row.children.some(task => task.phase === 'warrant')).length,
    completion: rows.filter(row => row.children.some(task => task.phase === 'completion')).length,
    attention: rows.filter(row => row.project.needsAttention).length,
    overdue: rows.filter(row => isOverdue(row.project, now)).length,
  }), [rows, now]);

  const visible = rows
    .filter(row => filter === 'all'
      || (filter === 'attention' ? row.project.needsAttention
        : filter === 'overdue' ? isOverdue(row.project, now)
          : row.children.some(task => task.phase === filter)))
    .filter(row => `${row.project.name} ${row.project.siteSummary} ${row.project.clientName ?? ''} ${row.project.internalReference ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.project.needsAttention) - Number(a.project.needsAttention) || Number(b.children.length > 0) - Number(a.children.length > 0));
  const tasks = useMemo(() => visible.flatMap(row => [row.parent, ...row.children]), [visible]);
  const height = Math.min(MAX_HEIGHT, SCALE_HEIGHT * 2 + Math.max(tasks.length, 1) * CELL_HEIGHT + 2);

  const scales = useMemo(() => [
    { unit: 'month' as const, step: 1, format: (date: Date) => monthYear.format(date) },
    { unit: 'week' as const, step: 1, format: (date: Date) => zoom === '6m' ? dayOnly.format(date) : `${dayMonth.format(date)} – ${dayOnly.format(new Date(date.getTime() + 6 * timelineDay))}`, css: (date: Date) => now >= date.getTime() && now < date.getTime() + 7 * timelineDay ? 'gt-this-week' : '' },
  ], [zoom, now]);
  const columns = useMemo(() => [{ id: 'text', header: 'Project', flexgrow: 1, cell: NameCell }], []);
  // The free Gantt has no today line, so the current week's column is shaded instead.
  const highlightTime = useMemo(() => (date: Date, unit: string) => unit === 'week' && now >= date.getTime() && now < date.getTime() + 7 * timelineDay ? 'gt-this-week' : '', [now]);

  // Clicking a bar opens that application on the project page; clicking a project opens the project.
  useEffect(() => {
    if (!api) return;
    api.on('select-task', ({ id }) => {
      if (!id) return;
      const [projectId, phase] = String(id).split('::');
      window.location.href = `/projects/${projectId}${phase ? `#${phaseAnchor[phase as Phase]}` : ''}`;
    });
  }, [api]);

  return <section id="project-timeline" className="tl panel" aria-labelledby="timeline-heading">
    <header className="tl-header">
      <div className="tl-title">
        <h2 id="timeline-heading">Council journey</h2>
        <p>Every active project, from first drawings to the council's decision.</p>
      </div>
      <div className="tl-controls">
        <label className="tl-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a project</span><input type="search" placeholder="Find a project" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="tl-zoom" role="group" aria-label="Timeline range">
          {zooms.map(item => <button key={item.key} type="button" aria-pressed={zoom === item.key} onClick={() => setZoom(item.key)}>{item.label}</button>)}
        </div>
      </div>
    </header>

    <div className="tl-filters" role="group" aria-label="Show projects">
      {filters.map(item => <button key={item.key} type="button" className={`tl-filter tl-filter-${item.key}`} aria-pressed={filter === item.key} onClick={() => onFilterChange(filter === item.key && item.key !== 'all' ? 'all' : item.key)}>
        {item.label}<strong>{counts[item.key]}</strong>
      </button>)}
      {filter === 'overdue' && <button type="button" className="tl-filter tl-filter-overdue" aria-pressed="true" onClick={() => onFilterChange('all')}>Overdue<strong>{counts.overdue}</strong></button>}
    </div>

    {visible.length > 0 && <div className="gt-frame" style={{ height }}>
      {mounted ? <Willow fonts={false}>
        <Tooltip api={api} content={TipContent as never}>
          <Gantt
            key={zoom}
            init={setApi}
            readonly
            tasks={tasks}
            links={[]}
            taskTypes={[{ id: 'planning', label: 'Planning' }, { id: 'warrant', label: 'Building warrant' }, { id: 'completion', label: 'Completion' }, { id: 'summary', label: 'Project' }, { id: 'task', label: 'Project' }]}
            columns={columns}
            scales={scales}
            start={new Date(weeks[0].start)}
            end={new Date(weeks[weeks.length - 1].end)}
            autoScale={false}
            cellWidth={view.cellWidth}
            cellHeight={CELL_HEIGHT}
            scaleHeight={SCALE_HEIGHT}
            gridWidth={gridWidth}
            highlightTime={highlightTime}
            unscheduledTasks
            cellBorders="column"
          />
        </Tooltip>
      </Willow> : <div className="gt-loading" />}
    </div>}

    {!visible.length && <div className="tl-none">
      <strong>{projects.length ? 'No projects match' : 'No active projects yet'}</strong>
      <p>{projects.length ? 'Try another search or show all projects.' : 'Start an application and it will appear on the timeline.'}</p>
      {projects.length ? <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); onFilterChange('all'); }}>Show all projects</button> : <a href="/applications/new" className="btn btn-primary">New application</a>}
    </div>}

    <footer className="tl-footer">
      <div className="tl-legend" aria-hidden="true">
        <span><i className="gt-key gt-planning" />Planning</span>
        <span><i className="gt-key gt-warrant" />Building warrant</span>
        <span><i className="gt-key gt-completion" />Completion</span>
        <span>The darker part of a bar is time already passed; a bar ends at the decision or the council's target date.</span>
      </div>
    </footer>
  </section>;
}
