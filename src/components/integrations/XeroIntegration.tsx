import { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign, Clock3, RefreshCw, Unplug } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type XeroConnection = {
  id: string;
  xeroTenantName: string;
  status: 'IDLE' | 'SYNCING' | 'CONNECTED' | 'ERROR' | 'RECONNECT_REQUIRED' | 'DISCONNECTED';
  baseCurrency: string | null;
  grantedScopes: string;
  draftInvoicePermissionGranted: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  snapshotCounts: { contacts: number; invoices: number; payments: number };
};
type FinanceSettings = { automaticDraftInvoices: boolean; defaultSalesAccountCode: string | null; defaultTaxType: string | null; defaultInvoiceDueDays: number | null } | null;
type ResponseData = { canManage: boolean; xeroConfigured: boolean; xero: XeroConnection | null; financeSettings: FinanceSettings };

const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not synced yet';

function DraftAutomationSettings({ settings, onSaved }: { settings: FinanceSettings; onSaved: () => Promise<void> }) {
  const [automatic, setAutomatic] = useState(settings?.automaticDraftInvoices ?? false);
  const [accountCode, setAccountCode] = useState(settings?.defaultSalesAccountCode ?? '');
  const [taxType, setTaxType] = useState(settings?.defaultTaxType ?? '');
  const [dueDays, setDueDays] = useState(String(settings?.defaultInvoiceDueDays ?? 14));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const save = async () => {
    setSaving(true); setStatus('');
    try {
      await apiRequest('/api/finance/settings', { method: 'PUT', body: JSON.stringify({
        automaticDraftInvoices: automatic,
        defaultSalesAccountCode: accountCode.trim() || null,
        defaultTaxType: taxType.trim() || null,
        defaultInvoiceDueDays: Number(dueDays),
      }) });
      setStatus('Draft automation settings saved.');
      await onSaved();
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : 'Could not save settings.');
    } finally { setSaving(false); }
  };
  return <div className="border-t border-stone-200 bg-stone-50/60 px-5 py-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <label className="flex flex-1 items-start gap-3"><input type="checkbox" className="mt-1" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} /><span><strong className="block text-sm">Automatic Xero drafts</strong><span className="mt-1 block text-xs leading-5 text-stone-500">When an agreed fee milestone becomes eligible, create a DRAFT only. Missing prerequisites create an action instead.</span></span></label>
      <label><span className="label">Sales account code</span><input className="field w-40" value={accountCode} onChange={(event) => setAccountCode(event.target.value)} placeholder="200" /></label>
      <label><span className="label">Tax type</span><input className="field w-40" value={taxType} onChange={(event) => setTaxType(event.target.value)} placeholder="OUTPUT2" /></label>
      <label><span className="label">Due days</span><input className="field w-24" type="number" min="0" max="365" value={dueDays} onChange={(event) => setDueDays(event.target.value)} /></label>
      <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
    </div>{status && <p className="mt-3 text-sm text-stone-600" role="status">{status}</p>}
  </div>;
}

export default function XeroIntegration() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [working, setWorking] = useState<'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<ResponseData>('/api/settings/integrations'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load Xero settings.');
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('xero') === 'connected') setMessage('Xero connected. Financial data is ready to review.');
    if (params.get('xero') === 'error') setError(params.get('message') || 'Xero connection failed.');
  }, [load]);

  const mutate = async (action: 'sync' | 'disconnect') => {
    if (action === 'disconnect' && !window.confirm('Disconnect Xero and remove cached Xero finance data and links from Architect Pro? Clients and projects will not be deleted.')) return;
    setWorking(action);
    setMessage('');
    setError('');
    try {
      await apiRequest(`/api/integrations/xero/${action}`, { method: 'POST' });
      setMessage(action === 'sync' ? 'Xero financial data synced.' : 'Xero disconnected and cached finance data removed.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Xero request failed.');
      await load();
    } finally {
      setWorking(null);
    }
  };

  if (!data) return <section className="panel rounded-lg p-6 text-sm text-stone-500">Loading Xero connection...</section>;
  if (!data.canManage) return null;
  const connected = Boolean(data.xero);
  const reconnect = data.xero?.status === 'RECONNECT_REQUIRED';

  return (
    <section className="panel overflow-hidden rounded-lg">
      {(message || error) && <div role={error ? 'alert' : 'status'} className={`border-b px-5 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || message}</div>}
      <div className="flex flex-col gap-5 border-b border-stone-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><CircleDollarSign size={22} aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">Xero</h2><span className={`text-xs font-semibold ${connected && !reconnect ? 'text-emerald-800' : 'text-stone-500'}`}>{connected ? reconnect ? 'Reconnect required' : 'Connected' : 'Not connected'}</span></div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">Contacts, invoices, payments and reports are imported read-only. Draft invoice creation is a separate, explicit permission.</p>
          </div>
        </div>
        {!connected || reconnect ? (
          <a href={data.xeroConfigured ? '/api/integrations/xero/connect' : undefined} aria-disabled={!data.xeroConfigured} className={`btn btn-primary shrink-0 ${!data.xeroConfigured ? 'pointer-events-none opacity-50' : ''}`}>{reconnect ? 'Reconnect' : 'Connect Xero'}</a>
        ) : (
          <div className="flex shrink-0 flex-wrap gap-2">
            <a className="btn btn-secondary" href="/finance">View finance</a>
            <button className="btn btn-primary gap-2" disabled={working !== null || data.xero?.status === 'SYNCING'} onClick={() => void mutate('sync')}><RefreshCw size={16} className={working === 'sync' ? 'animate-spin' : ''} />{working === 'sync' ? 'Syncing...' : 'Sync now'}</button>
            <button className="btn btn-secondary gap-2" disabled={working !== null} onClick={() => void mutate('disconnect')}><Unplug size={16} />Disconnect</button>
          </div>
        )}
      </div>
      <div className="grid gap-px bg-stone-200 sm:grid-cols-3">
        <div className="bg-white p-5"><p className="label">Xero organisation</p><p className="mt-2 font-medium">{data.xero?.xeroTenantName ?? 'No organisation connected'}</p><p className="mt-1 text-xs text-stone-500">Base currency {data.xero?.baseCurrency ?? 'not available'}</p></div>
        <div className="bg-white p-5"><p className="label">Last successful sync</p><p className="mt-2 flex items-center gap-2 font-medium"><Clock3 size={15} />{dateTime(data.xero?.lastSyncedAt ?? null)}</p></div>
        <div className="bg-white p-5"><p className="label">Cached records</p><p className="mt-2 font-medium">{data.xero ? `${data.xero.snapshotCounts.contacts} contacts · ${data.xero.snapshotCounts.invoices} invoices · ${data.xero.snapshotCounts.payments} payments` : 'None'}</p></div>
      </div>
      {data.xero?.lastSyncError && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">Last sync needs attention: {data.xero.lastSyncError}</div>}
      {connected && !reconnect && !data.xero?.draftInvoicePermissionGranted && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950"><span>Automatic fee milestones need permission to create Xero invoices. Architect Pro creates DRAFT invoices only.</span><a className="btn btn-secondary" href="/api/integrations/xero/connect?draft=1">Allow draft creation</a></div>}
      {connected && !reconnect && data.xero?.draftInvoicePermissionGranted && <DraftAutomationSettings settings={data.financeSettings} onSaved={load} />}
      {!data.xeroConfigured && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">Server setup is incomplete. Add the Xero environment variables before connecting.</div>}
    </section>
  );
}
