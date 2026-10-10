-- Optional external scheduler for Vercel Hobby. This is a setup template, not a
-- Prisma migration and has NOT been applied. Enable pg_cron and pg_net in the
-- Supabase dashboard first; keep DOCUMENT_PROCESSING_ENABLED=false until the
-- worker and private storage pass hosted recovery checks.
-- Store these Vault entries using the dashboard (never commit their values):
-- architect_document_worker_url: HTTPS URL ending /api/cron/document-processing
-- architect_document_worker_secret: the same random value as Vercel CRON_SECRET
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'architect_document_worker_url' AND decrypted_secret ~ '^https://.+/api/cron/document-processing$')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'architect_document_worker_secret' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Configure the worker URL and secret in Vault before scheduling.';
  END IF;
END $$;
SELECT cron.schedule(
  'architect-document-processing',
  '* * * * *',
  $job$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'architect_document_worker_url'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'architect_document_worker_secret')),
    timeout_milliseconds := 250000
  );
  $job$
);
-- Scheduling success only means the HTTP request was queued. Verify responses
-- in net._http_response plus cron.job_run_details, without logging headers.
-- To stop: SELECT cron.unschedule('architect-document-processing');
