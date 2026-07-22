import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type CalendarDeadline = {
  id: string;
  title: string;
  dueDate: string;
  status: 'UPCOMING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type: string;
  project: { id: string; name: string } | null;
};

type CalendarResponse = {
  month: string;
  gridStart: string;
  gridEnd: string;
  deadlines: CalendarDeadline[];
  googleConnection: {
    status: 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR' | 'PAUSED';
    accountEmail: string | null;
    lastSyncedAt: string | null;
    syncError: string | null;
  } | null;
};

type Props = {
  compact?: boolean;
  showIntegrationControls?: boolean;
  canManageIntegration?: boolean;
  showPageHeader?: boolean;
};

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.877 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');
const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const initialMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
};
const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const result = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}`;
};
const dateKey = (value: string) => value.slice(0, 10);
const dayLabel = (value: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' }).format(value);
const fullDate = (value: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-GB', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${month}-01T12:00:00.000Z`));
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const deadlineHref = (deadline: CalendarDeadline) => deadline.project?.id
  ? `/deadlines?projectId=${deadline.project.id}`
  : '/deadlines';

const deadlineTone = (deadline: CalendarDeadline, today: string) => {
  if (deadline.status === 'COMPLETED') return 'border-stone-200 bg-stone-100 text-stone-500 line-through';
  if (deadline.status === 'OVERDUE' || dateKey(deadline.dueDate) < today) return 'border-red-200 bg-red-50 text-red-800';
  if (deadline.priority === 'CRITICAL' || deadline.priority === 'HIGH' || deadline.status === 'DUE_SOON') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-moss/20 bg-moss/10 text-moss';
};

export default function PracticeCalendar({ compact = false, showIntegrationControls = false, canManageIntegration = false, showPageHeader = false }: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [integrationError, setIntegrationError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<CalendarResponse>(`/api/calendar?month=${month}`, { signal });
      setData(response);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message || 'Calendar could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const days = useMemo(() => {
    if (!data) return [];
    const start = new Date(data.gridStart);
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(start);
      value.setUTCDate(value.getUTCDate() + index);
      return value;
    });
  }, [data]);
  const deadlinesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarDeadline[]>();
    for (const deadline of data?.deadlines ?? []) {
      const key = dateKey(deadline.dueDate);
      grouped.set(key, [...(grouped.get(key) ?? []), deadline]);
    }
    return grouped;
  }, [data]);
  const monthDeadlines = useMemo(
    () => (data?.deadlines ?? []).filter((deadline) => dateKey(deadline.dueDate).startsWith(month)),
    [data, month],
  );
  const today = localDateKey(new Date());
  const linked = data?.googleConnection?.status === 'CONNECTED' || data?.googleConnection?.status === 'ERROR';

  const syncCalendar = async () => {
    setSyncing(true);
    setSyncMessage('');
    setIntegrationError('');
    try {
      const result = await apiRequest<{ synced?: number }>('/api/integrations/google-calendar/sync', { method: 'POST' });
      setSyncMessage(`${result.synced ?? 0} deadline${result.synced === 1 ? '' : 's'} synced with Google Calendar.`);
      await load();
    } catch (requestError) {
      setIntegrationError(requestError instanceof Error ? requestError.message : 'Google Calendar could not be synced.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      {showPageHeader && (
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-moss">Practice schedule</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-ink">Calendar</h1>
            <p className="mt-2 text-sm text-stone-500">Project deadlines and reminders, with Google Calendar sync status in one place.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageIntegration && linked && !loading && (
              <button type="button" className="btn btn-secondary gap-2" disabled={syncing} onClick={() => void syncCalendar()}>
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
                Sync
              </button>
            )}
            <a href="/deadlines" className="btn btn-primary">+ New deadline</a>
          </div>
        </div>
      )}

      <section className="panel overflow-hidden rounded-lg" aria-label="Practice calendar">
      {showIntegrationControls && !loading && !linked && (
        <div className="flex flex-col gap-4 border-b border-stone-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white shadow-sm">
              <GoogleLogo />
            </span>
            <div>
              <p className="font-semibold text-ink">Connect Google Calendar</p>
              <p className="mt-0.5 text-sm text-stone-600">Keep project deadlines available in your Google Calendar automatically.</p>
            </div>
          </div>
          {canManageIntegration ? (
            <a href="/api/integrations/google-calendar/connect" className="inline-flex h-11 shrink-0 items-center justify-center gap-3 rounded-md border border-[#747775] bg-white px-4 text-sm font-medium text-[#1f1f1f] shadow-sm transition hover:bg-[#f8fafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2">
              <GoogleLogo />
              Connect with Google
            </a>
          ) : <span className="text-sm text-stone-600">An owner or admin can manage this connection.</span>}
        </div>
      )}
      {syncMessage && <div role="status" className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:px-5">{syncMessage}</div>}
      {integrationError && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:px-5">{integrationError}</div>}
      <header className="flex flex-col gap-4 border-b border-stone-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-[#fbfaf6] text-moss">
            <CalendarDays size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-ink">Practice calendar</h2>
            <p className="mt-1 text-sm text-stone-500">
              {linked ? `Google Calendar connected${data?.googleConnection?.accountEmail ? ` as ${data.googleConnection.accountEmail}` : ''}.` : 'Internal project deadlines and reminders.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="btn btn-secondary h-10 w-10 p-0" aria-label="Previous month"><ChevronLeft size={17} /></button>
          <button type="button" onClick={() => setMonth(initialMonth())} className="btn btn-secondary h-10 px-4">Today</button>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="btn btn-secondary h-10 w-10 p-0" aria-label="Next month"><ChevronRight size={17} /></button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-5">
        <h3 className="text-lg font-semibold text-ink">{monthLabel(month)}</h3>
        <div className="hidden items-center gap-4 text-xs text-stone-500 sm:flex" aria-label="Calendar legend">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-700" />Overdue</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Priority</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-moss" />Upcoming</span>
        </div>
      </div>

      {error ? (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Calendar could not be loaded.</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary mt-3">Retry</button>
        </div>
      ) : loading && !data ? (
        <div className={`animate-pulse bg-stone-50 ${compact ? 'h-[430px]' : 'h-[620px]'}`} />
      ) : (
        <>
          <div className="hidden md:block">
            <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50/70 text-xs font-semibold uppercase text-stone-500">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <div key={weekday} className="px-3 py-2">{weekday}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = day.toISOString().slice(0, 10);
                const events = deadlinesByDate.get(key) ?? [];
                const inMonth = key.startsWith(month);
                return (
                  <div key={key} className={`border-b border-r border-stone-200 p-2 last:border-r-0 ${compact ? 'min-h-[92px]' : 'min-h-[118px]'} ${inMonth ? 'bg-white' : 'bg-stone-50/60'}`}>
                    <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${key === today ? 'bg-ink text-white' : inMonth ? 'text-stone-700' : 'text-stone-400'}`}>{dayLabel(day)}</div>
                    <div className="space-y-1">
                      {events.slice(0, compact ? 2 : 3).map((deadline) => (
                        <a key={deadline.id} href={deadlineHref(deadline)} title={`${deadline.title}${deadline.project ? ` - ${deadline.project.name}` : ''}`} className={`block truncate rounded border-l-2 px-2 py-1 text-[11px] font-medium no-underline transition hover:brightness-95 ${deadlineTone(deadline, today)}`}>
                          {deadline.title}
                        </a>
                      ))}
                      {events.length > (compact ? 2 : 3) && <a href="/deadlines" className="block px-1 text-[11px] font-semibold text-stone-500 hover:text-ink">+{events.length - (compact ? 2 : 3)} more</a>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-stone-200 md:hidden">
            {monthDeadlines.length ? monthDeadlines.map((deadline) => (
              <a key={deadline.id} href={deadlineHref(deadline)} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 px-4 py-3 transition hover:bg-stone-50">
                <time className="text-sm font-semibold text-stone-600">{fullDate(deadline.dueDate).split(' ').slice(0, 2).join(' ')}</time>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{deadline.title}</span>
                  <span className="mt-1 block truncate text-xs text-stone-500">{deadline.project?.name ?? 'General'} - {human(deadline.type)}</span>
                </span>
              </a>
            )) : <div className="px-4 py-10 text-center text-sm text-stone-500">No deadlines in {monthLabel(month)}.</div>}
          </div>
        </>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50/50 px-4 py-3 text-sm sm:px-5">
        <span className="text-stone-500">Deadlines in the portal remain the source of truth.</span>
        <div className="flex gap-4 font-semibold"><a href="/deadlines" className="hover:text-moss">Manage deadlines</a><a href="/settings/integrations" className="hover:text-moss">Calendar settings</a></div>
      </footer>
      </section>
    </>
  );
}
