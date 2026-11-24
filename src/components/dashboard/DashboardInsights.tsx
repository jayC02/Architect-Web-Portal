import { useId, useMemo, useState } from 'react';
import { ArrowUpRight, Bot, CalendarClock, CircleAlert, FileSearch, Flag, Landmark, ScrollText, Sparkles } from 'lucide-react';
import { dashboardDayKey } from '@/lib/dashboard/overview';
import { timelineDay } from '@/lib/dashboard/timeline';
import type { TimelineFilter, TimelineProject } from '@/components/dashboard/ProjectTimeline';

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
const dayNumber = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Europe/London' });

const isOverdue = (project: TimelineProject, now: number) => Boolean(project.nextDeadline && new Date(project.nextDeadline.dueDate).getTime() < now - timelineDay / 2);

/* ---------- On track ring ---------- */

export function OnTrackRing({ projects, onFilter }: { projects: TimelineProject[]; onFilter: (filter: TimelineFilter) => void }) {
  const now = Date.now();
  const overdue = projects.filter(project => isOverdue(project, now)).length;
  const needsYou = projects.filter(project => project.needsAttention && !isOverdue(project, now)).length;
  const onTrack = projects.length - overdue - needsYou;
  const total = Math.max(projects.length, 1);
  const percent = projects.length ? Math.round((onTrack / total) * 100) : 100;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { key: 'ontrack', value: onTrack, className: 'ring-ontrack', label: 'On track', filter: 'all' as TimelineFilter },
    { key: 'needs', value: needsYou, className: 'ring-needs', label: 'Needs you', filter: 'attention' as TimelineFilter },
    { key: 'overdue', value: overdue, className: 'ring-overdue', label: 'Overdue', filter: 'overdue' as TimelineFilter },
  ];
  let offset = 0;
  return <section className="ins-card ins-ring panel rounded-lg" aria-labelledby="ring-heading">
    <h2 id="ring-heading">Projects on track</h2>
    <div className="ins-ring-body">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${percent}% of ${projects.length} active projects on track; ${needsYou} need you; ${overdue} overdue`}>
        <circle cx="70" cy="70" r={radius} className="ring-track" />
        {segments.filter(segment => segment.value > 0).map(segment => {
          const length = (segment.value / total) * circumference;
          const element = <circle key={segment.key} cx="70" cy="70" r={radius} className={`ring-segment ${segment.className}`}
            strokeDasharray={`${Math.max(length - 3, 0.5)} ${circumference}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
          offset += length;
          return element;
        })}
        <text x="70" y="68" textAnchor="middle" className="ring-value">{percent}%</text>
        <text x="70" y="88" textAnchor="middle" className="ring-caption">on track</text>
      </svg>
      <ul className="ins-ring-legend">
        {segments.map(segment => <li key={segment.key}>
          <button type="button" onClick={() => onFilter(segment.filter)} disabled={!segment.value && segment.key !== 'ontrack'}>
            <span className={`ins-dot ${segment.className}`} aria-hidden="true" />{segment.label}<strong>{segment.value}</strong>
          </button>
        </li>)}
      </ul>
    </div>
  </section>;
}

/* ---------- With the council ---------- */

const planningWithCouncil = new Set(['SUBMITTED', 'VALIDATED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);
const warrantWithCouncil = new Set(['SUBMITTED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);

export function WithCouncil({ projects, onFilter }: { projects: TimelineProject[]; onFilter: (filter: TimelineFilter) => void }) {
  const today = dashboardDayKey(new Date());
  const summary = useMemo(() => {
    const planning = projects.filter(project => project.timeline?.planning && planningWithCouncil.has(project.timeline.planning.status));
    const warrant = projects.filter(project => project.timeline?.warrant && warrantWithCouncil.has(project.timeline.warrant.status));
    const completion = projects.filter(project => project.timeline?.warrant?.completionCertificateStatus === 'SUBMITTED');
    const targets = [
      ...planning.map(project => ({ project, kind: 'Planning decision', date: project.timeline?.planning?.targetDate })),
      ...warrant.map(project => ({ project, kind: 'Warrant response', date: project.timeline?.warrant?.targetDate })),
    ].filter((item): item is { project: TimelineProject; kind: string; date: string } => Boolean(item.date) && dashboardDayKey(item.date as string) >= today)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return { planning: planning.length, warrant: warrant.length, completion: completion.length, next: targets[0] ?? null };
  }, [projects, today]);
  const total = summary.planning + summary.warrant + summary.completion;
  const parts = [
    { key: 'planning' as const, label: 'Planning', value: summary.planning },
    { key: 'warrant' as const, label: 'Building warrant', value: summary.warrant },
    { key: 'completion' as const, label: 'Completion', value: summary.completion },
  ];
  const daysAway = summary.next ? Math.round((new Date(`${dashboardDayKey(summary.next.date)}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / timelineDay) : 0;
  return <section className="ins-card ins-council panel rounded-lg" aria-labelledby="council-heading">
    <div className="ins-title"><h2 id="council-heading">With the council</h2><Landmark size={18} aria-hidden="true" /></div>
    <p className="ins-big"><strong>{total}</strong> application{total === 1 ? '' : 's'} waiting on a decision</p>
    <div className="ins-stack" aria-hidden="true">
      {total ? parts.filter(part => part.value).map(part => <span key={part.key} className={`ins-fill-${part.key}`} style={{ flex: part.value }} />) : <span className="ins-fill-empty" />}
    </div>
    <ul className="ins-council-parts">
      {parts.map(part => <li key={part.key}><button type="button" disabled={!part.value} onClick={() => onFilter(part.key)}>
        <span className={`ins-dot ins-fill-${part.key}`} aria-hidden="true" />{part.label}<strong>{part.value}</strong>
      </button></li>)}
    </ul>
    <div className="ins-next">
      <CalendarClock size={16} aria-hidden="true" />
      {summary.next
        ? <span><a href={`/projects/${summary.next.project.id}`}>{summary.next.project.name}</a>: {summary.next.kind.toLowerCase()} {daysAway === 0 ? 'due today' : `due in ${daysAway} day${daysAway === 1 ? '' : 's'}`} ({dayMonth.format(new Date(summary.next.date))})</span>
        : <span>No council target dates recorded yet.</span>}
    </div>
  </section>;
}

/* ---------- Day strip ---------- */

type Deadline = { id: string; title: string; dueDate: string; project?: { id: string; name: string } | null };
type DayEvent = { id: string; kind: 'deadline' | 'planning' | 'warrant'; title: string; project?: { id: string; name: string } | null; date: string };

export function NextDays({ deadlines, projects, range, onRangeChange, loading }: {
  deadlines: Deadline[]; projects: TimelineProject[]; range: number; onRangeChange: (range: number) => void; loading: boolean;
}) {
  const rangeId = useId();
  const today = dashboardDayKey(new Date());
  const days = useMemo(() => Array.from({ length: range }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  }), [today, range]);
  const events = useMemo(() => {
    const items: DayEvent[] = deadlines.map(deadline => ({ id: `d-${deadline.id}`, kind: 'deadline', title: deadline.title, project: deadline.project, date: deadline.dueDate }));
    for (const project of projects) {
      const planningTarget = project.timeline?.planning?.targetDate;
      if (planningTarget && planningWithCouncil.has(project.timeline?.planning?.status ?? '')) items.push({ id: `p-${project.id}`, kind: 'planning', title: 'Planning decision due', project, date: String(planningTarget) });
      const warrantTarget = project.timeline?.warrant?.targetDate;
      if (warrantTarget && warrantWithCouncil.has(project.timeline?.warrant?.status ?? '')) items.push({ id: `w-${project.id}`, kind: 'warrant', title: 'Warrant response due', project, date: String(warrantTarget) });
    }
    return items;
  }, [deadlines, projects]);
  const byDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    for (const event of events) {
      const key = dashboardDayKey(event.date);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);
  const overdue = events.filter(event => event.kind === 'deadline' && dashboardDayKey(event.date) < today);
  const firstBusy = overdue.length ? 'overdue' : days.find(day => byDay.has(day)) ?? days[0];
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && (picked === 'overdue' || days.includes(picked)) ? picked : firstBusy;
  const list = selected === 'overdue' ? overdue : byDay.get(selected) ?? [];

  return <section id="upcoming-deadlines" className="ins-card ins-days panel rounded-lg" aria-labelledby="days-heading" aria-busy={loading}>
    <div className="ins-title">
      <h2 id="days-heading">Coming up</h2>
      <label htmlFor={rangeId} className="sr-only">Days to show</label>
      <select id={rangeId} className="ins-range" value={range} onChange={event => { setPicked(null); onRangeChange(Number(event.target.value)); }}>
        <option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option>
      </select>
    </div>
    <div className="ins-strip" role="group" aria-label="Choose a day">
      {overdue.length > 0 && <button type="button" className="ins-day is-overdue" aria-pressed={selected === 'overdue'} onClick={() => setPicked('overdue')}>
        <span>Late</span><strong>{overdue.length}</strong><i className="ins-day-dots"><b className="dot-overdue" /></i>
      </button>}
      {days.map(day => {
        const dayEvents = byDay.get(day) ?? [];
        const date = new Date(`${day}T12:00:00Z`);
        const weekend = [0, 6].includes(date.getUTCDay());
        return <button key={day} type="button" className={`ins-day${day === today ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}`} aria-pressed={selected === day}
          aria-label={`${longDay.format(date)}: ${dayEvents.length ? `${dayEvents.length} item${dayEvents.length === 1 ? '' : 's'}` : 'nothing due'}`} onClick={() => setPicked(day)}>
          <span>{day === today ? 'Today' : weekday.format(date)}</span><strong>{dayNumber.format(date)}</strong>
          <i className="ins-day-dots">{dayEvents.slice(0, 3).map(event => <b key={event.id} className={`dot-${event.kind}`} />)}</i>
        </button>;
      })}
    </div>
    <div className="ins-day-list" aria-live="polite">
      <p className="ins-day-heading">{selected === 'overdue' ? 'Overdue deadlines' : longDay.format(new Date(`${selected}T12:00:00Z`))}</p>
      {list.length ? <ul>{list.map(event => <li key={event.id}>
        <a href={event.project?.id ? `/projects/${event.project.id}${event.kind === 'deadline' ? '#deadlines' : event.kind === 'warrant' ? '#building-warrant' : '#planning'}` : '/deadlines'} className={`ins-event ins-event-${selected === 'overdue' ? 'overdue' : event.kind}`}>
          <span className="ins-event-icon" aria-hidden="true">{event.kind === 'deadline' ? <Flag size={14} /> : <Landmark size={14} />}</span>
          <span><strong>{event.title}</strong><span>{event.project?.name ?? 'General deadline'}{selected === 'overdue' ? ` · due ${dayMonth.format(new Date(event.date))}` : ''}</span></span>
        </a>
      </li>)}</ul> : <p className="ins-muted">Nothing due this day.</p>}
    </div>
    <a href="/deadlines" className="ins-link">Manage deadlines <ArrowUpRight size={14} aria-hidden="true" /></a>
  </section>;
}

/* ---------- Needs you ---------- */

type Attention = { id: string; type: string; projectName: string; reason: string; href: string; tone: string };

const attentionStyle = (item: Attention) => {
  if (item.type.startsWith('Overdue')) return { tone: 'overdue', icon: CircleAlert };
  if (item.type.includes('deadline')) return { tone: 'deadline', icon: Flag };
  if (item.type.startsWith('Documents') || item.type.startsWith('Missing')) return { tone: 'documents', icon: FileSearch };
  if (item.type.startsWith('Automation') || item.type.startsWith('Agent')) return { tone: 'automation', icon: Bot };
  if (item.type.startsWith('Warrant')) return { tone: 'warrant', icon: ScrollText };
  if (item.type.startsWith('Planning')) return { tone: 'planning', icon: Landmark };
  return { tone: 'review', icon: Sparkles };
};

export function NeedsYou({ items }: { items: Attention[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 5);
  return <section className="ins-card ins-needs panel rounded-lg" aria-labelledby="needs-heading">
    <div className="ins-title"><h2 id="needs-heading">Needs you</h2><span className="ins-count">{items.length}</span></div>
    {items.length ? <ul className="ins-needs-list">{shown.map(item => {
      const style = attentionStyle(item);
      const Icon = style.icon;
      return <li key={item.id}><a href={item.href} className={`ins-need ins-need-${style.tone}`}>
        <span className="ins-need-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="ins-need-copy"><span className="ins-need-type">{item.type}</span><strong>{item.projectName}</strong><span>{item.reason}</span></span>
      </a></li>;
    })}</ul> : <p className="ins-clear"><Sparkles size={18} aria-hidden="true" />Nothing needs you right now.</p>}
    {items.length > 5 && <button type="button" className="ins-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</button>}
  </section>;
}
