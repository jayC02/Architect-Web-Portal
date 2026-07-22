import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Laptop, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type DesktopToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value))
  : 'Never';

export default function DesktopAccessIntegration() {
  const [tokens, setTokens] = useState<DesktopToken[]>([]);
  const [deviceName, setDeviceName] = useState('ArchitectPro Desktop');
  const [newToken, setNewToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ tokens: DesktopToken[] }>('/api/settings/desktop-access-tokens');
      setTokens(result.tokens);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Desktop connections could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ token: string }>('/api/settings/desktop-access-tokens', {
        method: 'POST', json: { name: deviceName },
      });
      setNewToken(result.token);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Desktop access could not be created.');
    } finally {
      setWorking(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke access for this desktop device?')) return;
    await apiRequest(`/api/settings/desktop-access-tokens/${id}`, { method: 'DELETE' });
    await load();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="panel overflow-hidden rounded-lg">
      <div className="flex flex-col gap-5 border-b border-stone-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700"><Laptop size={22} /></span>
          <div>
            <h2 className="text-xl font-semibold">ArchitectPro Desktop</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">Authorise this Windows device to securely open project snapshots and documents. Your portal password is never shared with the desktop app.</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <input className="field min-w-0 sm:w-52" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} aria-label="Desktop device name" />
          <button className="btn btn-primary gap-2" disabled={working || !deviceName.trim()} onClick={() => void create()}><Plus size={16} />Connect device</button>
        </div>
      </div>

      {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>}
      {newToken && (
        <div className="border-b border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-950">Copy this connection token into ArchitectPro Desktop now</p>
          <p className="mt-1 text-sm text-amber-900">It is shown once and will be stored by the desktop app in Windows Credential Manager.</p>
          <div className="mt-3 flex gap-2">
            <input className="field min-w-0 flex-1 font-mono text-xs" readOnly value={newToken} />
            <button className="btn btn-secondary gap-2" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-stone-100">
        {tokens.length ? tokens.map((token) => (
          <div key={token.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{token.name}</p>
              <p className="mt-1 text-xs text-stone-500">Token {token.tokenPrefix}... · Last used {date(token.lastUsedAt)} · Expires {date(token.expiresAt)}</p>
            </div>
            <button className="btn btn-secondary gap-2 text-red-700" onClick={() => void revoke(token.id)}><Trash2 size={15} />Revoke</button>
          </div>
        )) : <p className="p-5 text-sm text-stone-500">No desktop device is connected yet.</p>}
      </div>
    </section>
  );
}
