import { useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Props = {
  projectId: string;
  type: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  planningApplicationId?: string;
  buildingWarrantApplicationId?: string;
  className?: string;
};

export default function AutomationLaunchButton({ projectId, type, planningApplicationId, buildingWarrantApplicationId, className = '' }: Props) {
  const [working, setWorking] = useState(false);
  const [launchUrl, setLaunchUrl] = useState('');
  const [error, setError] = useState('');

  const open = async () => {
    setWorking(true);
    setError('');
    setLaunchUrl('');
    try {
      const result = await apiRequest<{ launchUrl: string }>(`/api/projects/${projectId}/automation-jobs`, {
        method: 'POST',
        json: { type, planningApplicationId, buildingWarrantApplicationId },
      });
      setLaunchUrl(result.launchUrl);
      window.location.href = result.launchUrl;
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
        {working ? 'Preparing application...' : 'Open in Automation App'}
      </button>
      {launchUrl && (
        <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
          <p>ArchitectPro Desktop should now open. It must be installed and opened once on this Windows device.</p>
          <a className="mt-2 inline-flex font-semibold text-ink hover:underline" href={launchUrl}>Open Desktop App Again</a>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

export function ExistingAutomationJobButton({ jobId }: { jobId: string }) {
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
        {working ? 'Opening...' : 'Open in desktop app'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
