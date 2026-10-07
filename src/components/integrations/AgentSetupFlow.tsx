import releaseDefaults from '@/config/agent-release.json';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

export type DesktopAgent = {
  id: string;
  machineName: string;
  agentVersion: string;
  connected: boolean;
  usable: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  operatingState: string;
};

type Release = {
  version: string;
  downloadUrl: string;
  sourceDownloadUrl?: string;
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

const versionParts = (value: string) => value.split('.').map(Number);
const versionAtLeast = (value: string, minimum: string) => {
  const left = versionParts(value); const right = versionParts(minimum);
  for (let index = 0; index < 3; index++) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return true;
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

const lastSeenLabel = (value: string | null) => {
  if (!value) return 'Never seen';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Last seen just now';
  const minutes = Math.round(seconds / 60);
  return `Last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
};

function AgentGuide({ sourceDownloadUrl }: { sourceDownloadUrl: string }) {
  return <div className="mt-4 border-t border-stone-200 pt-3 text-sm leading-6 text-stone-600">
    <p>Use Update Agent for new versions. Your connection and saved login stay in place. If you download an installer, run it over the existing installation.</p>
    <p className="mt-1">Keep the Agent running in the Windows notification area. Queue your prepared applications here, and it will work through them one at a time.</p>
    <p className="mt-1">Save your eDevelopment login in Agent Settings. When an application is ready, review it in the council portal and submit it yourself.</p>
    <a href={sourceDownloadUrl} download className="mt-2 inline-block font-semibold text-ink underline underline-offset-2">Download updated Agent source code</a>
  </div>;
}

export default function AgentSetupFlow({ connectedAgent = null, compact = false, onConnected }: Props) {
  const [state, setState] = useState<'idle' | 'setting_up' | 'connected' | 'failed'>(connectedAgent?.connected && connectedAgent.usable ? 'connected' : 'idle');
  const [agent, setAgent] = useState<DesktopAgent | null>(connectedAgent);
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState('');
  const polling = useRef<number | null>(null);
  const expiryTimer = useRef<number | null>(null);
  const setupStartedAt = useRef(0);
  const expectedAgentId = useRef<string | null>(null);
  const expectedVersion = useRef('');
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState('');

  const stopPolling = () => {
    if (polling.current !== null) window.clearInterval(polling.current);
    if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
    polling.current = null;
    expiryTimer.current = null;
  };

  useEffect(() => () => stopPolling(), []);
  useEffect(() => {
    setAgent(connectedAgent);
    setState((current) => current === 'setting_up' ? current
      : connectedAgent?.connected && connectedAgent.usable && !connectedAgent.revokedAt ? 'connected'
      : current === 'failed' ? current : 'idle');
  }, [connectedAgent]);

  const checkConnection = async () => {
    try {
      const result = await apiRequest<{ agents: DesktopAgent[] }>('/api/settings/desktop-agents');
      const ready = result.agents.find((item) => item.connected && item.usable && !item.revokedAt
        && (!expectedAgentId.current || item.id === expectedAgentId.current)
        && Boolean(item.lastSeenAt && new Date(item.lastSeenAt).getTime() >= setupStartedAt.current)
        && versionAtLeast(item.agentVersion, expectedVersion.current));
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
      setUpdating(false);
      setNotice('');
      setupStartedAt.current = Date.now();
      expectedAgentId.current = connectedAgent?.id ?? null;
      const result = await apiRequest<{ release: Release; expiresAt: string }>('/api/settings/desktop-agents/setup', { method: 'POST' });
      setRelease(result.release);
      expectedVersion.current = result.release.version;
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

  const updateAgent = async () => {
    // Earlier Agents need this one installer upgrade; newer ones update in place.
    if (!agent || !versionAtLeast(agent.agentVersion, '4.2.1')) { await start(); return; }
    stopPolling();
    setError(''); setNotice(''); setUpdating(true);
    try {
      const latest = await apiRequest<Release>('/api/desktop/releases/latest');
      setRelease(latest);
      if (latest.status !== 'AVAILABLE') throw new Error('The latest update is being prepared. Try again shortly.');
      if (versionAtLeast(agent.agentVersion, latest.version)) {
        setNotice(`Agent ${agent.agentVersion} is already up to date.`);
        return;
      }
      expectedAgentId.current = agent.id;
      expectedVersion.current = latest.version;
      setupStartedAt.current = Date.now();
      setState('setting_up');
      window.location.href = 'architectpro://update';
      polling.current = window.setInterval(() => void checkConnection(), 3_000);
      expiryTimer.current = window.setTimeout(() => {
        stopPolling();
        setError('Open the Agent and finish or stop any running application, then choose Update Agent again.');
        setState('failed');
      }, 10 * 60_000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start the Agent update.');
      setState('failed');
    }
  };

  const openAgent = () => { window.location.href = 'architectpro://agent'; };

  if (state === 'connected' && agent?.connected && agent.usable && !agent.revokedAt) {
    return <div role="status" className={compact ? 'rounded-md border border-emerald-200 bg-emerald-50 p-4' : 'border-t border-emerald-200 bg-emerald-50 px-5 py-5'}><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={20} aria-hidden="true" /><div className="min-w-0"><p className="font-semibold text-emerald-950">Connected and ready</p><p className="mt-1 text-sm text-emerald-900">{agent.machineName} · Agent {agent.agentVersion} · {lastSeenLabel(agent.lastSeenAt)}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn btn-secondary gap-2" onClick={openAgent}><ExternalLink size={16} aria-hidden="true" />Open Agent</button><button type="button" className="btn btn-secondary gap-2" onClick={() => void updateAgent()}><Download size={16} aria-hidden="true" />Update Agent</button></div>{notice && <p role="status" className="mt-3 text-sm text-emerald-900">{notice}</p>}<AgentGuide sourceDownloadUrl={release?.sourceDownloadUrl ?? releaseDefaults.sourceDownloadUrl} /></div></div></div>;
  }

  if (state === 'setting_up') {
    return <div role="status" aria-live="polite" className={compact ? 'rounded-md border border-sky-200 bg-sky-50 p-4' : 'border-t border-sky-200 bg-sky-50 px-5 py-5'}><div className="flex items-start gap-3"><LoaderCircle className="mt-0.5 shrink-0 animate-spin text-sky-700" size={20} aria-hidden="true" /><div><p className="font-semibold text-sky-950">{updating ? 'Updating Agent...' : 'Connecting this computer...'}</p><p className="mt-1 text-sm text-sky-900">{updating ? 'The Agent will download, verify and install the update, then reopen with your connection and settings intact. Finish or stop a running application first.' : 'Run the downloaded installer over your existing Agent. Your settings and connection are kept; the Agent will open automatically when installation finishes.'}</p>{release && !release.signed && <p className="mt-3 text-xs text-sky-800">Internal unsigned release {release.version}: Windows may ask you to choose More info, then Run anyway.</p>}</div></div></div>;
  }

  const offline = connectedAgent && !connectedAgent.connected;
  const needsUpdate = connectedAgent?.connected && !connectedAgent.usable;
  return <div className={compact ? 'rounded-md border border-stone-200 bg-white p-4' : 'border-t border-stone-200 px-5 py-5'}>{state === 'failed' ? <><p className="font-semibold text-ink">We couldn't finish connecting this computer.</p>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<button type="button" className="btn btn-primary mt-4 gap-2" onClick={() => void (updating ? updateAgent() : start())}><RotateCcw size={16} aria-hidden="true" />Try again</button></> : <><p className="font-semibold text-ink">{needsUpdate ? 'Agent update required' : offline ? 'Agent is offline' : 'Desktop automation'}</p><p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">{needsUpdate ? 'Update Architect Pro Agent on this computer before running new applications.' : offline ? `Open Architect Pro Agent on ${connectedAgent.machineName} to reconnect. Reinstall only if the app is no longer on this computer.` : 'Install the Architect Pro Agent once to run Planning and Building Warrant applications directly from this computer.'}</p><div className="mt-4 flex flex-wrap gap-2">{offline && <button type="button" className="btn btn-primary gap-2" onClick={openAgent}><ExternalLink size={16} aria-hidden="true" />Open Agent</button>}<button type="button" className={offline ? 'btn btn-secondary gap-2' : 'btn btn-primary gap-2'} onClick={() => void start()}><Download size={16} aria-hidden="true" />{needsUpdate ? 'Update Agent' : offline ? 'Download installer' : 'Download & connect Agent'}</button></div><p className="mt-3 text-xs text-stone-500">Windows only. This internal release is currently unsigned and may show a Windows security prompt.</p></>}<AgentGuide sourceDownloadUrl={release?.sourceDownloadUrl ?? releaseDefaults.sourceDownloadUrl} /></div>;
}
