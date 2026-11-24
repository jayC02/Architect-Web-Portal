import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Sparkles } from 'lucide-react';
import { dashboardDayKey } from '@/lib/dashboard/overview';
import { timelineDay } from '@/lib/dashboard/timeline';
import { BarList } from '@/components/tremor/BarList';
import { Badge } from '@/components/tremor/Badge';
import { CategoryBar } from '@/components/tremor/CategoryBar';
import { DonutChart } from '@/components/tremor/DonutChart';
import { Tracker } from '@/components/tremor/Tracker';
import type { TimelineFilter, TimelineProject } from '@/components/dashboard/ProjectTimeline';

// The charts here are Tremor components (Apache 2.0), copied into src/components/tremor.

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });

const isOverdue = (project: TimelineProject, now: number) => Boolean(project.nextDeadline && new Date(project.nextDeadline.dueDate).getTime() < now - timelineDay / 2);

const Card = ({ id, title, aside, className = '', children }: { id: string; title: string; aside?: ReactNode; className?: string; children: ReactNode }) =>
  <section id={id} className={`flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm ${className}`} aria-labelledby={`${id}-heading`}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${id}-heading`} className="text-sm font-medium text-gray-500">{title}</h2>
      {aside}
    </div>
    {children}
  </section>;

/* ---------- On track ---------- */

export function OnTrackRing({ projects, onFilter }: { projects: TimelineProject[]; onFilter: (filter: TimelineFilter) => void }) {
  const now = Date.now();
  const overdue = projects.filter(project => isOverdue(project, now)).length;
  const needsYou = projects.filter(project => project.needsAttention && !isOverdue(project, now)).length;
  const onTrack = projects.length - overdue - needsYou;
  const rows = [
    { name: 'On track', amount: onTrack, color: 'bg-emerald-500', filter: 'all' as TimelineFilter },
    { name: 'Waiting on you', amount: needsYou, color: 'bg-amber-500', filter: 'attention' as TimelineFilter },
    { name: 'Overdue', amount: overdue, color: 'bg-red-500', filter: 'overdue' as TimelineFilter },
  ];
  return <Card id="on-track" title="Projects on track">
    <p className="mt-1 text-3xl font-semibold text-gray-900">{onTrack}<span className="text-lg font-medium text-gray-400"> / {projects.length}</span></p>
    <div className="mt-6 flex items-center gap-6">
      <DonutChart className="h-36 w-36 shrink-0" data={rows.filter(row => row.amount > 0)} category="name" value="amount"
        colors={rows.filter(row => row.amount > 0).map(row => row.name === 'On track' ? 'emerald' : row.name === 'Overdue' ? 'red' : 'amber')}
        showLabel label={`${projects.length ? Math.round((onTrack / projects.length) * 100) : 100}%`}
        valueFormatter={value => `${value} project${value === 1 ? '' : 's'}`} />
      <ul className="min-w-0 flex-1 divide-y divide-gray-100 text-sm">
        {rows.map(row => <li key={row.name}>
          <button type="button" className="flex w-full items-center gap-2.5 py-2 text-left text-gray-600 hover:text-gray-900 disabled:opacity-50" disabled={!row.amount && row.filter !== 'all'} onClick={() => onFilter(row.filter)}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${row.color}`} aria-hidden="true" />{row.name}
            <span className="ml-auto font-medium tabular-nums text-gray-900">{row.amount}</span>
          </button>
        </li>)}
      </ul>
    </div>
  </Card>;
}

/* ---------- With the council ---------- */

const planningWithCouncil = new Set(['SUBMITTED', 'VALIDATED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);
const warrantWithCouncil = new Set(['SUBMITTED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);

export function WithCouncil({ projects, onFilter }: { projects: TimelineProject[]; onFilter: (filter: TimelineFilter) => void }) {
  const now = Date.now();
  const summary = useMemo(() => {
    const waiting: { name: string; value: number; href: string; key: string }[] = [];
    let planning = 0; let warrant = 0; let completion = 0;
    for (const project of projects) {
      const plan = project.timeline?.planning;
      if (plan && planningWithCouncil.has(plan.status)) {
        planning += 1;
        if (plan.submissionDate) waiting.push({ key: `${project.id}-p`, name: `${project.name} · planning`, value: Math.max(1, Math.round((now - new Date(plan.submissionDate).getTime()) / timelineDay)), href: `/projects/${project.id}#planning` });
      }
      const bw = project.timeline?.warrant;
      if (bw && warrantWithCouncil.has(bw.status)) {
        warrant += 1;
        if (bw.submissionDate) waiting.push({ key: `${project.id}-w`, name: `${project.name} · warrant`, value: Math.max(1, Math.round((now - new Date(bw.submissionDate).getTime()) / timelineDay)), href: `/projects/${project.id}#building-warrant` });
      }
      if (bw?.completionCertificateStatus === 'SUBMITTED') completion += 1;
    }
    return { planning, warrant, completion, waiting };
  }, [projects, now]);
  const total = summary.planning + summary.warrant + summary.completion;
  const parts = [
    { key: 'planning' as const, label: 'Planning', value: summary.planning, dot: 'bg-cyan-500' },
    { key: 'warrant' as const, label: 'Warrant', value: summary.warrant, dot: 'bg-violet-500' },
    { key: 'completion' as const, label: 'Completion', value: summary.completion, dot: 'bg-emerald-500' },
  ];
  return <Card id="with-council" title="With the council">
    <p className="mt-1 text-3xl font-semibold text-gray-900">{total}<span className="text-lg font-medium text-gray-400"> waiting on a decision</span></p>
    {total > 0 && <CategoryBar className="mt-5" values={parts.map(part => part.value)} colors={['cyan', 'violet', 'emerald']} showLabels={false} />}
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
      {parts.map(part => <li key={part.key}><button type="button" disabled={!part.value} className="inline-flex items-center gap-2 hover:text-gray-900 disabled:opacity-50" onClick={() => onFilter(part.key)}>
        <span className={`h-2.5 w-2.5 rounded-sm ${part.dot}`} aria-hidden="true" />{part.label}<span className="font-medium tabular-nums text-gray-900">{part.value}</span>
      </button></li>)}
    </ul>
    {summary.waiting.length > 0 && <>
      <p className="mt-7 flex justify-between text-xs font-medium text-gray-500"><span>Application</span><span>Days with council</span></p>
      <BarList className="mt-2" data={summary.waiting.slice(0, 5)} valueFormatter={value => `${value}`} onValueChange={item => { window.location.href = item.href ?? '/projects'; }} />
    </>}
  </Card>;
}

/* ---------- Coming up ---------- */

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
    for (const event of events) map.set(dashboardDayKey(event.date), [...(map.get(dashboardDayKey(event.date)) ?? []), event]);
    return map;
  }, [events]);
  const overdue = events.filter(event => event.kind === 'deadline' && dashboardDayKey(event.date) < today);
  const upcoming = days.flatMap(day => (byDay.get(day) ?? []).map(event => ({ ...event, day })));
  const blocks = days.map(day => {
    const dayEvents = byDay.get(day) ?? [];
    const label = shortDay.format(new Date(`${day}T12:00:00Z`));
    const color = !dayEvents.length ? 'bg-gray-200' : dayEvents.some(event => event.kind === 'deadline') ? 'bg-amber-500' : dayEvents.some(event => event.kind === 'warrant') ? 'bg-violet-500' : 'bg-cyan-500';
    return { key: day, color, tooltip: dayEvents.length ? `${label}: ${dayEvents.map(event => event.project?.name ? `${event.title} (${event.project.name})` : event.title).join(', ')}` : `${label}: nothing due` };
  });
  const list = [...overdue.map(event => ({ ...event, day: 'overdue' })), ...upcoming];
  const href = (event: DayEvent) => event.project?.id ? `/projects/${event.project.id}${event.kind === 'deadline' ? '#deadlines' : event.kind === 'warrant' ? '#building-warrant' : '#planning'}` : '/deadlines';

  return <Card id="upcoming-deadlines" title="Coming up" className="mb-1" aside={<div className="flex items-center gap-4">
    <a href="/deadlines" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline">Manage deadlines <ArrowUpRight size={14} aria-hidden="true" /></a>
    <label htmlFor={rangeId} className="sr-only">Days to show</label>
    <select id={rangeId} aria-busy={loading} className="rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 shadow-sm" value={range} onChange={event => onRangeChange(Number(event.target.value))}>
      <option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option>
    </select>
  </div>}>
    <p className="mt-1 text-3xl font-semibold text-gray-900">{upcoming.length}<span className="text-lg font-medium text-gray-400"> due in the next {range} days{overdue.length ? `, ${overdue.length} overdue` : ''}</span></p>
    <Tracker className="mt-5 h-10" data={blocks} hoverEffect />
    <div className="mt-2 flex justify-between text-xs text-gray-500"><span>Today</span><span>{dayMonth.format(new Date(`${days[days.length - 1]}T12:00:00Z`))}</span></div>
    {list.length ? <ul className="mt-6 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
      {list.slice(0, 9).map(event => <li key={event.id} className="border-t border-gray-100">
        <a href={href(event)} className="group flex items-center gap-3 py-3">
          <span className={`h-9 w-1 shrink-0 rounded-full ${event.day === 'overdue' ? 'bg-red-500' : event.kind === 'deadline' ? 'bg-amber-500' : event.kind === 'warrant' ? 'bg-violet-500' : 'bg-cyan-500'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-900 group-hover:underline">{event.title}</span>
            <span className="block truncate text-xs text-gray-500">{event.project?.name ?? 'General deadline'}</span>
          </span>
          <Badge variant={event.day === 'overdue' ? 'error' : event.day === today ? 'warning' : 'neutral'}>{event.day === 'overdue' ? `Overdue, ${dayMonth.format(new Date(event.date))}` : event.day === today ? 'Today' : longDay.format(new Date(`${event.day}T12:00:00Z`)).replace(/ \w+$/, '')}</Badge>
        </a>
      </li>)}
    </ul> : <p className="mt-6 text-sm text-gray-500">Nothing due in the next {range} days.</p>}
  </Card>;
}

/* ---------- Needs you ---------- */

type Attention = { id: string; type: string; projectName: string; reason: string; href: string; tone: string };

// Some reasons carry raw status codes such as FURTHER_INFORMATION_REQUESTED; show them as words.
const readable = (text: string) => text.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, code => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}).replace(/ - /g, ', ');

const badgeFor = (item: Attention): 'error' | 'warning' | 'default' | 'neutral' =>
  item.type.startsWith('Overdue') || item.tone === 'danger' ? 'error' : item.tone === 'warning' ? 'warning' : item.tone === 'ready' ? 'default' : 'neutral';

export function NeedsYou({ items }: { items: Attention[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 5);
  return <Card id="needs-you" title="Needs you" aside={items.length > 0 && <Badge variant="warning">{items.length} open</Badge>}>
    {items.length ? <ul className="mt-3 divide-y divide-gray-100">{shown.map(item => <li key={item.id}>
      <a href={item.href} className="group flex items-center gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-gray-900 group-hover:underline">{item.projectName}</span></span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">{readable(item.reason)}</span>
        </span>
        <Badge variant={badgeFor(item)}>{item.type}</Badge>
        <ChevronRight size={16} className="shrink-0 text-gray-400 group-hover:text-gray-700" aria-hidden="true" />
      </a>
    </li>)}</ul> : <p className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700"><Sparkles size={16} aria-hidden="true" />Nothing needs you right now.</p>}
    {items.length > 5 && <button type="button" className="mt-auto self-start pt-2 text-sm font-medium text-gray-700 hover:underline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</button>}
  </Card>;
}
