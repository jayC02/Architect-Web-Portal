export const APPLICATION_UPLOAD_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 25 * 1024 * 1024,
  maxPackageBytes: 75 * 1024 * 1024,
  uploadConcurrency: 3,
  analysisConcurrency: 2,
  unfinishedDraftRetentionDays: 7,
  unfinalisedRetentionHours: 24,
  storageWarningBytes: 700 * 1024 * 1024,
  storageBlockBytes: 900 * 1024 * 1024,
} as const;

export const formatUploadLimit = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
