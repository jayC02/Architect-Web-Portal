import {createRoot} from 'react-dom/client';
import AgentSetupFlow from '../../src/components/integrations/AgentSetupFlow';
import '../../src/styles/global.css';
const offline = new URLSearchParams(location.search).has('offline');
createRoot(document.getElementById('root')!).render(<AgentSetupFlow connectedAgent={offline ? {
  id:'old-device',machineName:'Old computer',agentVersion:'4.2.7',connected:false,usable:false,
  revokedAt:null,lastSeenAt:null,operatingState:'DISCONNECTED',
} : null} />);
