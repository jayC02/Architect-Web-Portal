# Desktop Automation Handoff

The web portal now has a first-pass Automation Job queue. It does not run Selenium, AI, calendar sync, or government portal automation. It creates a reviewed, organisation-scoped data contract that the desktop app can consume in a later integration.

## Flow

1. A signed-in user opens a project, planning tracker, or building warrant tracker.
2. The user clicks a prepare action, such as `Prepare warrant job`.
3. The server verifies the active organisation and project membership.
4. The server builds a trusted snapshot from database records. The browser does not provide organisation IDs or raw data snapshots.
5. The job is saved as `DRAFT`.
6. The user reviews the snapshot on `/automation-jobs` and marks it `READY` when it is suitable for desktop processing.
7. The placeholder desktop endpoint can return ready/active jobs to an authenticated organisation session.

## Job Types

- `HOUSEHOLDER_PLANNING`
- `PLANNING_APPLICATION`
- `BUILDING_WARRANT`

## Snapshot Contract

Each job stores:

- `dataSnapshot`: project, client, site, planning/building warrant record, application question placeholder, and document metadata.
- `documentSnapshot`: a schema-versioned list of safe document references and metadata.

The snapshot intentionally excludes:

- passwords
- session tokens
- API keys
- `storageKey`
- raw local or private storage paths
- desktop credentials

The contract is validated with Zod in `src/lib/validation/automation-job.ts` and built by `src/server/services/automation-jobs.service.ts`.

## API Endpoints

- `GET /api/automation-jobs`
- `POST /api/automation-jobs`
- `GET /api/automation-jobs/[id]`
- `PATCH /api/automation-jobs/[id]`
- `GET /api/automation-jobs/[id]/desktop`

All routes are organisation-scoped. Mutations use origin checks, rate limiting, and Zod validation.

## Desktop Integration Later

The desktop app should eventually use a dedicated device/API token flow, not copied web session cookies. A later pass should add:

- per-organisation desktop device registration
- scoped desktop tokens stored securely on the desktop app
- a claim endpoint that moves `READY` jobs to `CLAIMED` or `IN_PROGRESS`
- completion/failure callbacks
- secure document download/streaming endpoints if the desktop app needs file bytes

For now, the desktop endpoint is deliberately protected by normal portal authentication and is a contract placeholder.
