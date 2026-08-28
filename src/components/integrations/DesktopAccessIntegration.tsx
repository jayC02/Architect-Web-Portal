import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Laptop, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import AgentSetupFlow, { type DesktopAgent } from '@/components/integrations/AgentSetupFlow';

export default function DesktopAccessIntegration() {
  const [agents, setAgents] = useState<DesktopAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setAgents((await apiRequest<{ agents: DesktopAgent[] }>('/api/settings/desktop-agents')).agents); setError(''); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Desktop Agents could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const activeAgent = useMemo(() => agents.find((agent) => !agent.revokedAt) ?? null, [agents]);

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this Architect Pro Agent? It will not be able to claim new applications.')) return;
    setWorking(true); setError('');
    try { await apiRequest(`/api/settings/desktop-agents/${id}`, { method: 'DELETE' }); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The Agent could not be revoked.'); }
    finally { setWorking(false); }
  };

  return <section className="panel overflow-hidden rounded-lg">
    <div className="flex min-w-0 gap-4 p-5 sm:p-6"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700"><Laptop size={22} /></span><div><h2 className="text-xl font-semibold">Desktop Agent</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">The Agent runs approved applications securely on this computer and keeps portal credentials in Windows Credential Manager.</p><p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800"><ShieldCheck size={16} />Narrow, revocable organisation access</p></div></div>
    {error && <p role="alert" className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-800">{error}</p>}
    {loading ? <p className="flex items-center gap-2 border-t border-stone-200 px-5 py-4 text-sm text-stone-500"><LoaderCircle size={15} className="animate-spin" />Checking Agent connection…</p> : <AgentSetupFlow connectedAgent={activeAgent} onConnected={() => void load()} />}
    {agents.length > 0 && <div className="border-t border-stone-200">{agents.map((agent) => <div key={agent.id} className="flex flex-col gap-3 border-b border-stone-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{agent.connected && !agent.revokedAt ? <CheckCircle2 className="mt-0.5 text-emerald-700" size={18} /> : <Laptop className="mt-0.5 text-stone-400" size={18} />}<div><p className="font-semibold">{agent.machineName}</p><p className="mt-1 text-xs text-stone-500">{agent.revokedAt ? 'Revoked' : agent.connected ? 'Connected and ready' : 'Agent is offline'} · Agent {agent.agentVersion} · {agent.lastSeenAt ? `Last seen ${new Date(agent.lastSeenAt).toLocaleString('en-GB')}` : 'Never seen'}</p></div></div>{!agent.revokedAt && <button className="btn btn-secondary min-h-9 gap-2" disabled={working} onClick={() => void revoke(agent.id)}><Unplug size={14} />Revoke</button>}</div>)}</div>}
  </section>;
}
