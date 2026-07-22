import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, RefreshCw, Unplug } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Connection = {
  id: string;
  provider: 'GOOGLE' | 'OUTLOOK';
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR' | 'PAUSED';
  accountEmail: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  syncedEventCount: number;
};

type IntegrationsResponse = {
  connections: Connection[];
  canManage: boolean;
  googleConfigured: boolean;
};

const formatDateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not synced yet';

export default function GoogleCalendarIntegration() {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiRequest<IntegrationsResponse>('/api/settings/integrations'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load calendar settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') setMessage('Google Calendar connected and existing deadlines synced.');
    if (params.get('google') === 'error') setError(params.get('message') || 'Google Calendar connection failed.');
  }, [load]);

  const mutate = async (action: 'sync' | 'disconnect') => {
    if (action === 'disconnect' && !window.confirm('Disconnect Google Calendar? Events created by the portal will be removed from Google Calendar.')) return;
    setWorking(action);
    setMessage('');
    setError('');
    try {
      const result = await apiRequest<{ synced?: number; removed?: number }>(`/api/integrations/google-calendar/${action}`, { method: 'POST' });
      setMessage(action === 'sync'
        ? `${result.synced ?? 0} deadline${result.synced === 1 ? '' : 's'} synced with Google Calendar.`
        : 'Google Calendar disconnected.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Calendar request failed.');
    } finally {
      setWorking(null);
    }
  };

  if (loading && !data) {
    return <div className="panel rounded-lg p-6 text-sm text-stone-500">Loading calendar connection...</div>;
  }

  const google = data?.connections.find((connection) => connection.provider === 'GOOGLE');
  const connected = google?.status === 'CONNECTED' || google?.status === 'ERROR';

  return (
    <div className="space-y-5">
      {message && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="panel overflow-hidden rounded-lg">
        <div className="flex flex-col gap-5 border-b border-stone-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
              <CalendarDays size={22} aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">Google Calendar</h2>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${connected ? 'text-emerald-800' : 'text-stone-500'}`}>
                  <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-600' : 'bg-stone-300'}`} />
                  {connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
                Portal deadlines are the source of truth. Active deadlines are added to the connected account's primary calendar and updated automatically.
              </p>
            </div>
          </div>

          {!connected ? (
            <a
              href={data?.googleConfigured && data?.canManage ? '/api/integrations/google-calendar/connect' : undefined}
              aria-disabled={!data?.googleConfigured || !data?.canManage}
              className={`btn btn-primary shrink-0 gap-2 ${!data?.googleConfigured || !data?.canManage ? 'pointer-events-none opacity-50' : ''}`}
            >
              <CalendarDays size={17} aria-hidden="true" /> Connect Google Calendar
            </a>
          ) : (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button className="btn btn-primary gap-2" disabled={!data?.canManage || working !== null} onClick={() => void mutate('sync')}>
                <RefreshCw size={16} className={working === 'sync' ? 'animate-spin' : ''} aria-hidden="true" />
                {working === 'sync' ? 'Syncing...' : 'Sync now'}
              </button>
              <button className="btn btn-secondary gap-2" disabled={!data?.canManage || working !== null} onClick={() => void mutate('disconnect')}>
                <Unplug size={16} aria-hidden="true" /> Disconnect
              </button>
              {google?.status === 'ERROR' && data?.googleConfigured && data?.canManage && (
                <a className="btn btn-secondary" href="/api/integrations/google-calendar/connect">Reconnect</a>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-px bg-stone-200 sm:grid-cols-3">
          <div className="bg-white p-5">
            <p className="text-xs font-semibold uppercase text-stone-500">Connected account</p>
            <p className="mt-2 truncate text-sm font-medium text-ink">{google?.accountEmail ?? 'No Google account connected'}</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-xs font-semibold uppercase text-stone-500">Last synced</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-ink"><Clock3 size={15} aria-hidden="true" /> {formatDateTime(google?.lastSyncedAt ?? null)}</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-xs font-semibold uppercase text-stone-500">Synced deadlines</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-ink"><CheckCircle2 size={15} aria-hidden="true" /> {google?.syncedEventCount ?? 0} active event{google?.syncedEventCount === 1 ? '' : 's'}</p>
          </div>
        </div>

        {google?.syncError && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Last sync needs attention: {google.syncError}
          </div>
        )}
        {!data?.googleConfigured && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Server setup is incomplete. Add the Google Calendar environment variables before connecting an account.
          </div>
        )}
        {!data?.canManage && (
          <div className="border-t border-stone-200 bg-stone-50 px-5 py-3 text-sm text-stone-600">
            An organisation owner or admin can change this connection.
          </div>
        )}
      </section>

      <section className="panel rounded-lg p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Outlook Calendar</h2>
            <p className="mt-1 text-sm text-stone-500">Microsoft calendar sync will be added after the Google workflow is proven.</p>
          </div>
          <span className="text-xs font-semibold text-stone-500">Coming later</span>
        </div>
      </section>
    </div>
  );
}
