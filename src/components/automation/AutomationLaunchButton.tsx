import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Play, X } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import AgentSetupFlow from '@/components/integrations/AgentSetupFlow';

type Props = {
  projectId: string;
  type: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  planningApplicationId?: string;
  buildingWarrantApplicationId?: string;
  className?: string;
  label?: string;
  destination?: 'job' | 'preparation';
};

export default function AutomationLaunchButton({ projectId, type, planningApplicationId, buildingWarrantApplicationId, className = '', label = 'Open in Automation App', destination = 'job' }: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ redirectTo: string; preparationRedirectTo: string }>(`/api/projects/${projectId}/automation-jobs`, {
        method: 'POST',
        json: { type, planningApplicationId, buildingWarrantApplicationId },
      });
      window.location.assign(destination === 'preparation' ? result.preparationRedirectTo : result.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The desktop application could not be prepared.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={className}>
      <button type="button" className="btn btn-primary gap-2" disabled={working} onClick={() => void open()}>
        {working ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
        {working ? 'Preparing application...' : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

export function ExistingAutomationJobButton({ jobId, label = 'Open in desktop app' }: { jobId: string; label?: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ launchUrl: string }>(`/api/automation-jobs/${jobId}/launch`, { method: 'POST' });
      window.location.href = result.launchUrl;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The desktop application could not be opened.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-primary gap-2" disabled={working} onClick={() => void open()}>
        {working ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
        {working ? 'Opening...' : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

export function RunAutomationJobButton({ jobId }: { jobId: string }) {
  const [working, setWorking] = useState(false);
  const [queued, setQueued] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsAgent, setNeedsAgent] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (needsAgent && dialog && !dialog.open) dialog.showModal();
  }, [needsAgent]);

  const closeSetup = () => {
    dialogRef.current?.close();
    setNeedsAgent(false);
  };

  const run = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ compatibleAgentOnline: boolean }>(`/api/automation-jobs/${jobId}/run`, { method: 'POST' });
      setQueued(true);
      setNeedsAgent(!result.compatibleAgentOnline);
      setMessage(result.compatibleAgentOnline
        ? 'Authorised. Your connected Agent will start automatically.'
        : 'Your application is safely queued. Connect the Desktop Agent and it will start automatically.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be queued.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-primary gap-2" disabled={working || queued} onClick={() => void run()}>
        {working ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
        {working ? 'Authorising...' : queued ? 'Application queued' : 'Run application'}
      </button>
      {message && <p role="status" className="mt-2 max-w-xs text-sm font-medium text-moss">{message}</p>}
      <dialog ref={dialogRef} onCancel={closeSetup} className="settings-dialog m-auto w-[min(36rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40">
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-semibold">Desktop Agent required</h2><p className="mt-2 max-w-lg text-sm leading-6 text-stone-600">Architect Pro uses a small Windows app to complete this application securely on the government portal.</p><p className="mt-2 text-sm font-medium text-stone-700">Setup normally takes about a minute.</p></div>
            <button type="button" onClick={closeSetup} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/40" aria-label="Cancel Desktop Agent setup"><X size={20} aria-hidden="true" /></button>
          </div>
          <div className="mt-5"><AgentSetupFlow compact onConnected={() => { setMessage('Connected. Your queued application will start automatically.'); }} /></div>
          <div className="mt-5 flex justify-end border-t border-stone-200 pt-4"><button type="button" className="btn btn-secondary" onClick={closeSetup}>Cancel</button></div>
        </div>
      </dialog>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
