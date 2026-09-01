import { useCallback, useEffect, useState } from 'react';
import AgentSetupFlow, { type DesktopAgent } from '@/components/integrations/AgentSetupFlow';
import { apiRequest } from '@/lib/api/http';

export default function DesktopAutomationSetupCard() {
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    try {
      const result = await apiRequest<{ agents: DesktopAgent[] }>('/api/settings/desktop-agents');
      setVisible(!result.agents.some((agent) => agent.connected && agent.usable && !agent.revokedAt));
    } catch {
      setVisible(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  if (!visible) return null;

  return (
    <aside className="mt-6 max-w-3xl" aria-label="Desktop automation setup">
      <AgentSetupFlow compact onConnected={() => setVisible(false)} />
    </aside>
  );
}
