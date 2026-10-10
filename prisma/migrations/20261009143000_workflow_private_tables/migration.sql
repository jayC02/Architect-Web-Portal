-- These tables are server-owned. Supabase browser roles must never access
-- upload tombstones, processing payload metadata or financial audit records.
DO $$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['UploadRateLimit','ProjectUploadIntent','DocumentProcessingJob','ProjectFeeRevision','XeroCreditNoteSnapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
