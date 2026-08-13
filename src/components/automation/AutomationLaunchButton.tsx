import { useState } from 'react';
import { ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

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

export function RestartAutomationJobButton({ jobId }: { jobId: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const restart = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ preparationRedirectTo: string }>(`/api/automation-jobs/${jobId}/restart`, {
        method: 'POST',
      });
      window.location.assign(result.preparationRedirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Desktop automation could not be restarted.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-secondary gap-2" disabled={working} onClick={() => void restart()}>
        {working ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}
        {working ? 'Preparing again...' : 'Restart desktop automation'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
