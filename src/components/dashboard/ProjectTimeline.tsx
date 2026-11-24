import { useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { Check, Flag, Search, X } from 'lucide-react';
import { buildProjectTimeline, timelineDay, timelineWeeks, type TimelineBar, type TimelineInput, type TimelineMarker } from '@/lib/dashboard/timeline';

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

const zooms = [
  { key: '6w', label: '6 weeks', before: 2, weeks: 6 },
  { key: '3m', label: '3 months', before: 4, weeks: 13 },
  { key: '6m', label: '6 months', before: 8, weeks: 26 },
] as const;

const filters: { key: TimelineFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'planning', label: 'Planning' },
  { key: 'warrant', label: 'Building warrant' },
  { key: 'completion', label: 'Completion' },
  { key: 'attention', label: 'Needs you' },
];

const PAGE = 8;
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const dayOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Europe/London' });
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Europe/London' });
const stateLabel = { preparing: 'Preparing', council: 'With the council', projected: 'Decision expected', decided: 'Decided' } as const;

type Tip = { x: number; y: number; title: string; detail: string };

const isOverdue = (project: TimelineProject, now: number) => Boolean(project.nextDeadline && new Date(project.nextDeadline.dueDate).getTime() < now - timelineDay / 2);

export default function ProjectTimeline({ projects, filter, onFilterChange }: Props) {
  const [zoom, setZoom] = useState<(typeof zooms)[number]['key']>('3m');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const now = useMemo(() => Date.now(), []);
  const view = zooms.find(item => item.key === zoom) ?? zooms[1];
  const weeks = useMemo(() => timelineWeeks(now - view.before * 7 * timelineDay, view.weeks), [now, view]);
  const windowStart = weeks[0].start;
  const windowEnd = weeks[weeks.length - 1].end;
  const span = windowEnd - windowStart;
  const position = (at: number) => ((at - windowStart) / span) * 100;

  const months = useMemo(() => {
    const groups: { label: string; weeks: number }[] = [];
    for (const week of weeks) {
      const label = monthName.format(new Date(week.start + 3 * timelineDay));
      const last = groups[groups.length - 1];
      if (last?.label === label) last.weeks += 1; else groups.push({ label, weeks: 1 });
    }
    return groups;
  }, [weeks]);

  const rows = useMemo(() => projects.map(project => ({
    project,
    ...buildProjectTimeline(project.timeline ?? {}, new Date(now)),
  })), [projects, now]);

  const counts = useMemo(() => ({
    all: rows.length,
    planning: rows.filter(row => row.bars.some(bar => bar.phase === 'planning')).length,
    warrant: rows.filter(row => row.bars.some(bar => bar.phase === 'warrant')).length,
    completion: rows.filter(row => row.bars.some(bar => bar.phase === 'completion')).length,
    attention: rows.filter(row => row.project.needsAttention).length,
    overdue: rows.filter(row => isOverdue(row.project, now)).length,
  }), [rows, now]);

  const visible = rows
    .filter(row => filter === 'all'
      || (filter === 'attention' ? row.project.needsAttention
        : filter === 'overdue' ? isOverdue(row.project, now)
          : row.bars.some(bar => bar.phase === filter)))
    .filter(row => `${row.project.name} ${row.project.siteSummary} ${row.project.clientName ?? ''} ${row.project.internalReference ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    // Projects that need you come first, then those already moving through the council.
    .sort((a, b) => Number(b.project.needsAttention) - Number(a.project.needsAttention) || Number(b.bars.length > 0) - Number(a.bars.length > 0));
  const shown = expanded ? visible : visible.slice(0, PAGE);

  const showTip = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, title: string, detail: string) => {
    const chart = chartRef.current?.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    if (!chart) return;
    const pointer = 'clientX' in event ? event.clientX : target.left + target.width / 2;
    setTip({ x: Math.min(Math.max(pointer - chart.left, 120), chart.width - 120), y: target.top - chart.top, title, detail });
  };

  const barDetail = (bar: TimelineBar) => {
    const ongoing = bar.end >= now - timelineDay && bar.state !== 'decided' && bar.state !== 'projected';
    return `${stateLabel[bar.state]} · ${dayMonth.format(bar.start)} to ${ongoing ? 'today' : dayMonth.format(bar.end)}`;
  };

  const anchorFor = (bar: TimelineBar) => bar.phase === 'completion' ? 'completion-certificate' : bar.phase === 'warrant' ? 'building-warrant' : 'planning';

  const renderBar = (project: TimelineProject, bar: TimelineBar, index: number, rowIndex: number) => {
    const start = Math.max(bar.start, windowStart);
    const end = Math.min(bar.end, windowEnd);
    if (end <= windowStart || start >= windowEnd) return null;
    const left = position(start);
    const width = Math.max(position(end) - left, 0.8);
    const style = { left: `${left}%`, width: `${width}%`, '--row': rowIndex } as CSSProperties;
    const classes = ['tl-bar', `tl-${bar.phase}`, `tl-${bar.state}`, bar.start < windowStart && 'tl-cut-start', bar.end > windowEnd && 'tl-cut-end'].filter(Boolean).join(' ');
    return <a
      key={`${bar.phase}-${bar.state}-${index}`}
      href={`/projects/${project.id}#${anchorFor(bar)}`}
      className={classes}
      data-lane={bar.lane}
      style={style}
      aria-label={`${project.name}: ${bar.label}, ${barDetail(bar)}`}
      onPointerEnter={event => showTip(event, bar.label, barDetail(bar))}
      onPointerLeave={() => setTip(null)}
      onFocus={event => showTip(event, bar.label, barDetail(bar))}
      onBlur={() => setTip(null)}
    >{width > 9 && bar.state !== 'projected' && <span>{stateLabel[bar.state]}</span>}</a>;
  };

  const renderMarker = (marker: TimelineMarker, index: number) => {
    if (marker.at < windowStart || marker.at > windowEnd) return null;
    const icon = marker.kind === 'approved' ? <Check size={11} strokeWidth={3} aria-hidden="true" />
      : marker.kind === 'refused' ? <X size={11} strokeWidth={3} aria-hidden="true" />
        : marker.kind === 'deadline' || marker.kind === 'overdue' ? <Flag size={11} strokeWidth={2.5} aria-hidden="true" /> : null;
    return <span
      key={`${marker.kind}-${index}`}
      className={`tl-marker tl-marker-${marker.kind}`}
      data-lane={marker.lane}
      style={{ left: `${position(marker.at)}%` }}
      onPointerEnter={event => showTip(event, marker.label, dayMonth.format(marker.at))}
      onPointerLeave={() => setTip(null)}
      aria-hidden="true"
    >{icon}</span>;
  };

  const todayLeft = position(now);

  return <section id="project-timeline" className="tl panel rounded-lg" aria-labelledby="timeline-heading">
    <header className="tl-header">
      <div>
        <h2 id="timeline-heading">Council journey</h2>
        <p>Where every active project is with planning and building warrant.</p>
      </div>
      <div className="tl-zoom" role="group" aria-label="Timeline range">
        {zooms.map(item => <button key={item.key} type="button" aria-pressed={zoom === item.key} onClick={() => setZoom(item.key)}>{item.label}</button>)}
      </div>
    </header>

    <div className="tl-toolbar">
      <div className="tl-filters" role="group" aria-label="Show projects">
        {filters.map(item => <button key={item.key} type="button" className={`tl-filter tl-filter-${item.key}`} aria-pressed={filter === item.key} onClick={() => { onFilterChange(filter === item.key && item.key !== 'all' ? 'all' : item.key); setExpanded(false); }}>
          {item.key !== 'all' && <span className="tl-swatch" aria-hidden="true" />}{item.label}<strong>{counts[item.key]}</strong>
        </button>)}
        {filter === 'overdue' && <button type="button" className="tl-filter tl-filter-overdue" aria-pressed="true" onClick={() => onFilterChange('all')}><span className="tl-swatch" aria-hidden="true" />Overdue<strong>{counts.overdue}</strong></button>}
      </div>
      <label className="tl-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Find a project</span><input type="search" placeholder="Find a project" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>

    <div className="tl-legend" aria-hidden="true">
      <span><i className="tl-key tl-key-preparing" />Preparing</span>
      <span><i className="tl-key tl-key-council" />With the council</span>
      <span><i className="tl-key tl-key-projected" />Decision expected</span>
      <span><i className="tl-marker-key tl-marker-submitted" />Submitted</span>
      <span><i className="tl-marker-key tl-marker-target" />Target date</span>
      <span><i className="tl-marker-key tl-marker-approved"><Check size={9} strokeWidth={3} /></i>Decision</span>
      <span><i className="tl-marker-key tl-marker-deadline"><Flag size={9} strokeWidth={2.5} /></i>Deadline</span>
    </div>

    <div className="tl-scroll">
      <div className="tl-chart" ref={chartRef} style={{ '--weeks': weeks.length } as CSSProperties}>
        <div className="tl-row tl-head" aria-hidden="true">
          <div className="tl-cell tl-corner">Project</div>
          <div className="tl-track">
            <div className="tl-months">{months.map(month => <span key={`${month.label}-${month.weeks}`} style={{ flex: month.weeks }}>{month.label}</span>)}</div>
            <div className="tl-weeks">{weeks.map(week => <span key={week.start} className={now >= week.start && now < week.end ? 'is-current' : undefined}>{dayOnly.format(week.start)}–{dayOnly.format(week.end - timelineDay)}</span>)}</div>
          </div>
        </div>

        {shown.map(({ project, bars, markers }, rowIndex) => {
          const overdue = isOverdue(project, now);
          const lanes = new Set(bars.map(bar => bar.lane));
          return <div key={project.id} className={`tl-row${project.needsAttention ? ' needs-you' : ''}`}>
            <div className="tl-cell tl-project">
              <a href={`/projects/${project.id}`} className="tl-project-name">{project.name}</a>
              <span className="tl-project-meta">{project.internalReference ? `${project.internalReference} · ` : ''}{project.clientName ?? project.siteSummary}</span>
              {project.nextAction && <a href={project.nextAction.href ?? `/projects/${project.id}`} className={`tl-next tl-next-${overdue ? 'danger' : project.nextAction.tone ?? 'neutral'}`}>{project.nextAction.label}</a>}
            </div>
            <div className="tl-track tl-lanes" style={{ '--weeks': weeks.length } as CSSProperties}>
              {lanes.size === 0 && <span className="tl-empty-lane">No application started yet</span>}
              {bars.map((bar, index) => renderBar(project, bar, index, rowIndex))}
              {markers.map(renderMarker)}
            </div>
          </div>;
        })}

        {todayLeft > 0 && todayLeft < 100 && <div className="tl-today" style={{ '--today': todayLeft / 100 } as CSSProperties} aria-hidden="true" />}
        {tip && <div className="tl-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}><strong>{tip.title}</strong><span>{tip.detail}</span></div>}
      </div>
    </div>

    {!visible.length && <div className="tl-none">
      <strong>{projects.length ? 'No projects match' : 'No active projects yet'}</strong>
      <p>{projects.length ? 'Try another search or show all projects.' : 'Start an application and it will appear on the timeline.'}</p>
      {projects.length ? <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); onFilterChange('all'); }}>Show all projects</button> : <a href="/applications/new" className="btn btn-primary">New application</a>}
    </div>}
    {visible.length > PAGE && <button type="button" className="tl-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer projects' : `Show all ${visible.length} projects`}</button>}
  </section>;
}
