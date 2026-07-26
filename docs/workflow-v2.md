# Portal Preparation And Snapshot V2

## Authoritative modules

- Snapshot contract: `src/lib/validation/automation-job.ts`
- Snapshot builder and source revision calculation: `src/server/services/automation-jobs.service.ts`
- Deterministic preflight: `src/server/services/automation-preflight.service.ts`
- Legal lifecycle transitions: `src/server/services/automation-lifecycle.service.ts`
- Prepared application review: `src/pages/automation-job/[id].astro`
- Browser preparation routes: `src/pages/api/planning/[id]/preparation.ts` and `src/pages/api/building-warrant/[id]/preparation.ts`
- Desktop exchange/claim/callback routes: `src/pages/api/desktop`
- Private document access: `src/lib/server/upload-storage.ts` and `src/pages/api/desktop/documents/[id].ts`

The portal owns organisation defaults, project/client/site/application data and reviewed document classifications. An `AutomationJob` snapshot is an immutable execution input. It never contains credentials, provider keys, raw storage paths or public document URLs.

## Migration

The workflow schema migration is:

`prisma/migrations/20260726133000_workflow_foundations/migration.sql`

It is additive and preserves legacy fields and snapshot-v1 jobs. It has not been applied to production by Codex.

Local development:

```powershell
npm install
npx prisma generate
npx prisma migrate dev
```

Production, after reviewing the SQL and taking a database backup:

```powershell
npx prisma migrate deploy
```

No destructive backfill is required. Existing projects remain usable; organisation defaults, structured client fields and preparation records can be completed gradually. Rollback should restore the pre-migration database backup and prior application deployment together because deployed v2 code expects the additive columns and enums.

## Lifecycle semantics

Desktop success means `AWAITING_PORTAL_REVIEW`, not submitted. The user may explicitly complete the desktop job after reviewing the government portal form. Submission/reference/date remain application-record actions and are never inferred from Selenium completion.

Ready jobs are checked for stale source data again at launch. If the project data changed, the job moves to `STALE` and must be prepared again.

