import defaults from '@/config/agent-release.json';

export type AgentReleaseMetadata = {
  version: string;
  downloadUrl: string;
  sourceDownloadUrl: string | null;
  sha256: string;
  sizeBytes: number;
  minimumSupportedVersion: string;
  status: 'AVAILABLE' | 'BUILDING' | 'UNAVAILABLE';
  signed: boolean;
};

export const agentReleaseMetadata = (): AgentReleaseMetadata => {
  const version = process.env.AGENT_RELEASE_VERSION || defaults.version;
  const validVersion = /^\d+\.\d+\.\d+$/.test(version);
  const useDefaults = version === defaults.version;
  const versionedInstaller = `/downloads/ArchitectProAgentSetup-${version}.exe`;
  const downloadUrl = process.env.AGENT_RELEASE_DOWNLOAD_URL || (useDefaults ? defaults.downloadUrl : versionedInstaller);
  const sha256 = process.env.AGENT_RELEASE_SHA256 || (useDefaults ? defaults.sha256 : '');
  const configuredSize = Number(process.env.AGENT_RELEASE_SIZE_BYTES || (useDefaults ? defaults.sizeBytes : 0));
  const sizeBytes = Number.isSafeInteger(configuredSize) && configuredSize > 0 ? configuredSize : 0;
  const configuredStatus = (process.env.AGENT_RELEASE_STATUS || defaults.status).toUpperCase();
  const complete = validVersion && downloadUrl === versionedInstaller
    && /^[a-f0-9]{64}$/i.test(sha256) && sizeBytes > 0;
  // The 4.1.0 archive contains only the installer.
  const sourceDownloadUrl = !validVersion || version === '4.1.0' ? null
    : useDefaults ? defaults.sourceDownloadUrl
    : `/downloads/ArchitectProAgentSource-${version}.zip`;

  return {
    version,
    downloadUrl,
    sourceDownloadUrl,
    sha256,
    sizeBytes,
    minimumSupportedVersion: process.env.AGENT_MINIMUM_SUPPORTED_VERSION || defaults.minimumSupportedVersion,
    status: configuredStatus === 'UNAVAILABLE' ? 'UNAVAILABLE'
      : configuredStatus === 'AVAILABLE' && complete ? 'AVAILABLE' : 'BUILDING',
    signed: (process.env.AGENT_RELEASE_SIGNED || String(useDefaults && defaults.signed)).toLowerCase() === 'true',
  };
};
