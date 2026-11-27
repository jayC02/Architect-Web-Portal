import defaults from '@/config/agent-release.json';

export type AgentReleaseMetadata = {
  version: string;
  downloadUrl: string;
  sourceDownloadUrl: string;
  sha256: string;
  sizeBytes: number;
  minimumSupportedVersion: string;
  status: 'AVAILABLE' | 'BUILDING' | 'UNAVAILABLE';
  signed: boolean;
};

// Where the installer and source live in the private release bucket. Never
// served publicly: /agent/download checks entitlement, then issues a
// short-lived signed URL (see src/server/billing/release-storage.ts).
export const agentReleaseStorageKeys = (version = agentReleaseMetadata().version) => ({
  installer: process.env.AGENT_RELEASE_STORAGE_KEY || (version === defaults.version ? defaults.storageKey : `ArchitectProAgentSetup-${version}.exe`),
  source: process.env.AGENT_RELEASE_SOURCE_STORAGE_KEY || (version === defaults.version ? defaults.sourceStorageKey : `ArchitectProAgentSource-${version}.zip`),
});

const status = (process.env.AGENT_RELEASE_STATUS || defaults.status).toUpperCase();

export const agentReleaseMetadata = (): AgentReleaseMetadata => ({
  version: process.env.AGENT_RELEASE_VERSION || defaults.version,
  // Always the gated route; the bytes live in private storage.
  downloadUrl: defaults.downloadUrl,
  sourceDownloadUrl: defaults.sourceDownloadUrl,
  sha256: process.env.AGENT_RELEASE_SHA256 || defaults.sha256,
  sizeBytes: Number(process.env.AGENT_RELEASE_SIZE_BYTES || defaults.sizeBytes),
  minimumSupportedVersion: process.env.AGENT_MINIMUM_SUPPORTED_VERSION || defaults.minimumSupportedVersion,
  status: status === 'AVAILABLE' || status === 'UNAVAILABLE' ? status : 'BUILDING',
  signed: (process.env.AGENT_RELEASE_SIGNED || String(defaults.signed)).toLowerCase() === 'true',
});
