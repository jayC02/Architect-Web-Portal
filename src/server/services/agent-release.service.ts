import defaults from '@/config/agent-release.json';

export type AgentReleaseMetadata = {
  version: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  minimumSupportedVersion: string;
  status: 'AVAILABLE' | 'BUILDING' | 'UNAVAILABLE';
  signed: boolean;
};

const status = (process.env.AGENT_RELEASE_STATUS || defaults.status).toUpperCase();

export const agentReleaseMetadata = (): AgentReleaseMetadata => ({
  version: process.env.AGENT_RELEASE_VERSION || defaults.version,
  downloadUrl: process.env.AGENT_RELEASE_DOWNLOAD_URL || defaults.downloadUrl,
  sha256: process.env.AGENT_RELEASE_SHA256 || defaults.sha256,
  sizeBytes: Number(process.env.AGENT_RELEASE_SIZE_BYTES || defaults.sizeBytes),
  minimumSupportedVersion: process.env.AGENT_MINIMUM_SUPPORTED_VERSION || defaults.minimumSupportedVersion,
  status: status === 'AVAILABLE' || status === 'UNAVAILABLE' ? status : 'BUILDING',
  signed: (process.env.AGENT_RELEASE_SIGNED || String(defaults.signed)).toLowerCase() === 'true',
});
