import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Laptop, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Agent = { id: string; machineName: string; agentVersion: string; connected: boolean; revokedAt: string | null; lastSeenAt: string | null; operatingState: string };

export default function DesktopAccessIntegration({ canManage = false }: { canManage?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [working, setWorking] = useState(false);
  const [enrollment, setEnrollment] = useState<{ token: string; organisationId: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    if (!canManage) return;
    try { setAgents((await apiRequest<{ agents: Agent[] }>('/api/settings/desktop-agents')).agents); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Desktop Agents could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [canManage]);
  useEffect(() => {
    if (!enrollment) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [enrollment]);
  const connectedAgents = agents.filter((agent) => agent.connected && !agent.revokedAt);
  const createEnrollment = async () => {
    setWorking(true); setError('');
    try { setEnrollment(await apiRequest('/api/settings/desktop-agents', { method: 'POST' })); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Enrollment could not be created.'); }
    finally { setWorking(false); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this Architect Pro Agent? It will not be able to claim new applications.')) return;
    setWorking(true); setError('');
    try { await apiRequest(`/api/settings/desktop-agents/${id}`, { method: 'DELETE' }); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The Agent could not be revoked.'); }
    finally { setWorking(false); }
  };
  return <section className="panel overflow-hidden rounded-lg">
    <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
      <div className="flex min-w-0 gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700"><Laptop size={22} /></span><div><h2 className="text-xl font-semibold">Desktop Agent</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">The Agent runs approved applications securely on this computer and keeps portal credentials in Windows Credential Manager.</p><p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800"><ShieldCheck size={16} />Narrow, revocable Agent access only</p></div></div>
      {canManage && !loading && !connectedAgents.length && <button className="btn btn-primary shrink-0" disabled={working} onClick={() => void createEnrollment()}>{working ? 'Creating…' : 'Connect Desktop Agent'}</button>}
    </div>
    {error && <p role="alert" className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-800">{error}</p>}
    {enrollment && !connectedAgents.length && <div className="border-t border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-950"><p className="font-semibold">Finish connecting on this computer</p><ol className="mt-3 grid gap-2 sm:grid-cols-3"><li><span className="font-semibold">1. Install and open</span><br />Open Architect Pro Agent on the computer that will run applications.</li><li><span className="font-semibold">2. Paste the code</span><br />In the Agent, choose Connect Agent and paste the one-time code.</li><li><span className="font-semibold">3. Confirm connection</span><br />This page will update when the Agent is online.</li></ol><div className="mt-4 flex flex-wrap items-center gap-2"><code className="max-w-full overflow-x-auto rounded border border-amber-200 bg-white px-3 py-2 text-xs">{enrollment.organisationId}:{enrollment.token}</code><button className="btn btn-secondary min-h-9 gap-2" onClick={() => void navigator.clipboard.writeText(`${enrollment.organisationId}:${enrollment.token}`)}><Copy size={14} />Copy one-time code</button></div><p className="mt-2 text-xs">Expires at {new Date(enrollment.expiresAt).toLocaleTimeString('en-GB')}.</p></div>}
    {canManage && <div className="border-t border-stone-200">{loading ? <p className="flex items-center gap-2 px-5 py-4 text-sm text-stone-500"><LoaderCircle size={15} className="animate-spin" />Checking Agent connection…</p> : agents.length ? agents.map((agent) => <div key={agent.id} className="flex flex-col gap-3 border-b border-stone-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{agent.connected && !agent.revokedAt ? <CheckCircle2 className="mt-0.5 text-emerald-700" size={18} /> : <Laptop className="mt-0.5 text-stone-400" size={18} />}<div><p className="font-semibold">{agent.machineName}</p><p className="mt-1 text-xs text-stone-500"><span className={agent.connected ? 'text-emerald-700' : 'text-stone-500'}>{agent.connected ? 'Connected and ready' : agent.revokedAt ? 'Revoked' : 'Offline'}</span> · Agent {agent.agentVersion} · {agent.lastSeenAt ? `Last seen ${new Date(agent.lastSeenAt).toLocaleString('en-GB')}` : 'Never seen'}</p></div></div>{!agent.revokedAt && <button className="btn btn-secondary min-h-9 gap-2" disabled={working} onClick={() => void revoke(agent.id)}><Unplug size={14} />Revoke</button>}</div>) : <div className="px-5 py-5"><p className="font-semibold text-ink">No Agent connected</p><p className="mt-1 text-sm text-stone-500">Install and open Architect Pro Agent, then use Connect Desktop Agent above to create the one-time code.</p></div>}</div>}
  </section>;
}
