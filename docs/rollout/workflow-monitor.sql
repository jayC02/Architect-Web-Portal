-- Run against the intended migrated schema. These queries expose identifiers
-- and counts only; no document contents, credentials or signed URLs.
SELECT "organisationId", state, count(*) AS jobs, min("createdAt") AS oldest
FROM public."DocumentProcessingJob"
WHERE state IN ('WAITING', 'RETRYING', 'RUNNING', 'FAILED')
GROUP BY "organisationId", state;
SELECT count(*) AS expired_leases FROM public."DocumentProcessingJob"
WHERE state = 'RUNNING' AND "leaseExpiresAt" < now();
SELECT state, count(*) AS jobs, count(*) FILTER (WHERE attempts > 1) AS retried
FROM public."DocumentProcessingJob" GROUP BY state;
SELECT status, count(*) AS uploads, min("createdAt") AS oldest
FROM public."ProjectUploadIntent" WHERE "projectDocumentId" IS NULL AND "cancelledAt" IS NULL GROUP BY status;
SELECT "uploadStatus", count(*) AS uploads, min("createdAt") AS oldest
FROM public."ApplicationDraftDocument" WHERE "committedDocumentId" IS NULL AND "cancelledAt" IS NULL GROUP BY "uploadStatus";
SELECT status, count(*) AS connections, min("lastSyncedAt") AS oldest_success
FROM public."XeroConnection" GROUP BY status;
