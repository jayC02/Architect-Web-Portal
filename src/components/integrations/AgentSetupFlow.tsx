import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

export type DesktopAgent = {
  id: string;
  machineName: string;
  agentVersion: string;
  connected: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  operatingState: string;
};

type Release = {
  version: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  minimumSupportedVersion: string;
  status: 'AVAILABLE' | 'BUILDING' | 'UNAVAILABLE';
  signed: boolean;
};

type Props = {
  connectedAgent?: DesktopAgent | null;
  compact?: boolean;
  onConnected?: (agent: DesktopAgent) => void;
};

const beginDownload = (url: string) => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

export default function AgentSetupFlow({ connectedAgent = null, compact = false, onConnected }: Props) {
  const [state, setState] = useState<'idle' | 'setting_up' | 'connected' | 'failed'>(connectedAgent?.connected ? 'connected' : 'idle');
  const [agent, setAgent] = useState<DesktopAgent | null>(connectedAgent);
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState('');
  const polling = useRef<number | null>(null);
  const expiryTimer = useRef<number | null>(null);
  const alreadyConnectedAgents = useRef<Map<string, string>>(new Map());

  const stopPolling = () => {
    if (polling.current !== null) window.clearInterval(polling.current);
    if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
    polling.current = null;
    expiryTimer.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const checkConnection = async () => {
    try {
      const result = await apiRequest<{ agents: DesktopAgent[] }>('/api/settings/desktop-agents');
      const ready = result.agents.find((item) => item.connected && !item.revokedAt
        && alreadyConnectedAgents.current.get(item.id) !== item.agentVersion);
      if (!ready) return;
      stopPolling();
      setAgent(ready);
      setState('connected');
      onConnected?.(ready);
    } catch {
      // A transient status request should not disrupt the installer flow.
    }
  };

  const start = async () => {
    stopPolling();
    setState('setting_up');
    setError('');
    try {
      const before = await apiRequest<{ agents: DesktopAgent[] }>('/api/settings/desktop-agents');
      alreadyConnectedAgents.current = new Map(
        before.agents.filter((item) => item.connected && !item.revokedAt).map((item) => [item.id, item.agentVersion]),
      );
      const result = await apiRequest<{ release: Release; expiresAt: string }>('/api/settings/desktop-agents/setup', { method: 'POST' });
      setRelease(result.release);
      beginDownload(result.release.downloadUrl);
      polling.current = window.setInterval(() => void checkConnection(), 3_000);
      const remainingMs = Math.max(0, new Date(result.expiresAt).getTime() - Date.now());
      expiryTimer.current = window.setTimeout(() => {
        stopPolling();
        setError('The secure setup window expired. Start again to create a fresh connection.');
        setState('failed');
      }, remainingMs);
      void checkConnection();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "We couldn't start Agent setup.");
      setState('failed');
    }
  };

  const openAgent = () => { window.location.href = 'architectpro://agent'; };

  if (state === 'connected' && agent) {
    return <div className={compact ? 'rounded-md border border-emerald-200 bg-emerald-50 p-4' : 'border-t border-emerald-200 bg-emerald-50 px-5 py-5'}><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={20} /><div><p className="font-semibold text-emerald-950">Connected and ready</p><p className="mt-1 text-sm text-emerald-900">{agent.machineName} · Agent {agent.agentVersion} · Last seen just now</p></div></div></div>;
  }

  if (state === 'setting_up') {
    return <div className={compact ? 'rounded-md border border-sky-200 bg-sky-50 p-4' : 'border-t border-sky-200 bg-sky-50 px-5 py-5'}><div className="flex items-start gap-3"><LoaderCircle className="mt-0.5 shrink-0 animate-spin text-sky-700" size={20} /><div><p className="font-semibold text-sky-950">Connecting this computer…</p><p className="mt-1 text-sm text-sky-900">Finish the Windows installation if prompted. The Agent will open Architect Pro and connect automatically.</p>{release && !release.signed && <p className="mt-3 text-xs text-sky-800">Internal unsigned release {release.version}: Windows may ask you to choose More info, then Run anyway.</p>}</div></div></div>;
  }

  const offline = connectedAgent && !connectedAgent.connected;
  return <div className={compact ? 'rounded-md border border-stone-200 bg-white p-4' : 'border-t border-stone-200 px-5 py-5'}>{state === 'failed' ? <><p className="font-semibold text-ink">We couldn't finish connecting this computer.</p>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<button className="btn btn-primary mt-4 gap-2" onClick={() => void start()}><RotateCcw size={16} />Try again</button></> : <><p className="font-semibold text-ink">{offline ? 'Agent is offline' : 'Desktop automation'}</p><p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">{offline ? `Open the Agent on ${connectedAgent.machineName} to reconnect it. Reinstall only if the app is no longer on this computer.` : 'Architect Pro uses a small Windows app to complete government portal applications securely on this computer.'}</p><div className="mt-4 flex flex-wrap gap-2">{offline && <button className="btn btn-primary gap-2" onClick={openAgent}><ExternalLink size={16} />Open Agent</button>}<button className={offline ? 'btn btn-secondary gap-2' : 'btn btn-primary gap-2'} onClick={() => void start()}><Download size={16} />{offline ? 'Reinstall Agent' : 'Download & connect Agent'}</button></div><p className="mt-3 text-xs text-stone-500">Windows only. This internal release is currently unsigned and may show a Windows security prompt.</p></>}</div>;
}
