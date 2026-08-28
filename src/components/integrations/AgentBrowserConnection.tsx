import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Props = {
  installationId: string;
  codeChallenge: string;
  state: string;
  port: number;
  hasSetupIntent: boolean;
};

export default function AgentBrowserConnection(props: Props) {
  const started = useRef(false);
  const [working, setWorking] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(!props.hasSetupIntent);
  const [error, setError] = useState('');

  const connect = async (confirmed = false) => {
    setWorking(true);
    setError('');
    try {
      const result = await apiRequest<{ callbackUrl: string }>('/api/settings/desktop-agents/authorise', {
        method: 'POST',
        json: {
          installationId: props.installationId,
          codeChallenge: props.codeChallenge,
          state: props.state,
          port: props.port,
          confirmed,
        },
      });
      window.location.replace(result.callbackUrl);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'This computer could not be connected.';
      if (message === 'SETUP_CONFIRMATION_REQUIRED') {
        setNeedsConfirmation(true);
      } else {
        setError(message);
      }
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!props.hasSetupIntent || started.current) return;
    started.current = true;
    void connect(false);
  }, [props.hasSetupIntent]);

  return (
    <section className="panel w-full max-w-lg rounded-lg p-6 sm:p-8" aria-labelledby="agent-connect-title">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-moss">
          {working ? <LoaderCircle className="animate-spin" size={22} /> : <CheckCircle2 size={22} />}
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-moss">Desktop automation</p>
          <h1 id="agent-connect-title" className="mt-1 text-2xl font-semibold text-ink">
            {needsConfirmation ? 'Connect this computer' : 'Connecting this computer…'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            {needsConfirmation
              ? 'Connect the Architect Pro Agent to your current organisation. No code or organisation ID is required.'
              : 'Keep Architect Pro Agent open while the secure connection is completed.'}
          </p>
        </div>
      </div>
      {needsConfirmation && (
        <button className="btn btn-primary mt-6 w-full" disabled={working} onClick={() => void connect(true)}>
          {working ? 'Connecting…' : 'Connect'}
        </button>
      )}
      {error && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
      {!needsConfirmation && !error && <p role="status" aria-live="polite" className="mt-5 text-sm text-stone-500">Returning to Architect Pro Agent securely…</p>}
    </section>
  );
}
