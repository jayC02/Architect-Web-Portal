# Phase 0 — application and automation ownership

## Scope and design decision

Phase 0 only. The existing application tables, queue, authorisation decisions, ordering, retries, Selenium actions, UI, payment and submission flows are retained. No new frontend controls were introduced.

Use versioned, append-only `state_model.*` records in `AutomationJobEvent`, rather than creating parallel application/job tables. The journal already supplies a stable primary key, an idempotency key, organisation and job ownership, creation timestamps and useful indexes. There are **no Prisma schema changes, migrations or historical backfills**. JSON relationship integrity is checked by the domain service, rather than new foreign keys. This is a deliberate conservative tradeoff, not a claim that the journal is a new relational schema.

## Existing architecture and lifecycle

| Concept | Existing representation | Meaning and Phase 0 treatment |
| --- | --- | --- |
| Logical application | `PlanningApplication` or `BuildingWarrantApplication`, attached to `Project` | Keep the application identity and editable fields/preparationData on these records. Do not turn automation attempts into applications. |
| Pre-creation draft | `ApplicationDraft.confirmedData`, preparedData, documents, resulting application IDs | Existing draft remains valid. Its resulting application references describe the commit result, not an execution attempt. |
| Editable revision | Each draft/application's `updatedAt` | `editableRevision()` formalises an opaque row revision. No new counter or conflict UI. This is not an aggregate revision of related client/site/project rows. |
| Prepared snapshot | `AutomationJob.dataSnapshot`, documentSnapshot, snapshotHash, payloadVersion, sourceUpdatedAt | Existing v1/v2 payloads remain intact. Archive copies and the authorised pointer are recorded in the journal. sourceUpdatedAt is an aggregate source watermark, not a fabricated historical draft revision. |
| Queue job | `AutomationJob.id`, status, executionAuthorisedAt | Existing stable queue identity and ordering retained. This model previously also held mutable preparation projection and current-run fields. |
| Current execution | agentRunId, claimedDeviceId, claimedByAgentId, claimedAt, leases and job status | These remain the operational fields. Immutable run ownership and state history are added to the journal. |
| Agent installation | `AgentRegistration.id` / installationId / organisationId | Installation identity and authentication are unchanged. |
| Execution credential | `DesktopAccessToken.id` | Job-scoped access identity; legacy unscoped tokens remain supported. Not a connection-session ID. No credential value/hash is copied into history. |
| Agent connection session | No reliable separate identity exists | Explicitly null in new records. Do not misrepresent a heartbeat, credential or installation as a connected session. |
| Retained browser | ManagedChrome, Selenium session ID, in-memory retained-browser registries | Optional callback metadata associates the exact retained session with its authenticated run. Existing reveal/focus behaviour is unchanged. |
| Review | Application/job preparedAt/reviewedAt and final-review action items | Job.reviewedAt is preparation approval, not proof of post-automation review. An explicit internal helper distinguishes prepared versus reviewed without inventing user actions. |
| Submission | Existing application statuses, references, submissionDate and lifecycle services | Unchanged and independent from automation completion. No new submission inference. |

Current path:

1. Draft review saves editable JSON; commit creates/updates project/application/document records. Existing application preparation routes also save application fields and build a job snapshot.
2. The existing Run/complete-details/retry paths authorise the job. Merely creating a draft still does not implicitly authorise it in Phase 0.
3. The background queue selects authorised READY jobs in the existing order. Automatic claim, desktop claim and one-use handoff exchange retain their current locking/token rules.
4. Desktop reads the payload and documents, then requires a started callback acknowledgement before creating the browser. Selenium runs the existing workflow.
5. Result callbacks remain idempotent and update the existing job projection and final-review actions. Lease reconciliation still handles unstarted expiry and interrupted runs as before.
6. Submission tracking remains architect-controlled and independent from those preparation results.

## Added domain model

Implementation: `src/lib/automation/state-model.ts` and `src/server/services/automation-state-model.service.ts`.

All new journal records contain version 1 and belong to the existing organisation/job row:

- `state_model.snapshot`: immutable data/document payload copy, payload version, content hash, verified application/project identity, source watermark. Its event ID is snapshot_id. Content-identical copies are idempotent per job.
- `state_model.authorisation`: existing authorised timestamp -> snapshot ID. The existing authorisation field update and this record commit atomically. Snapshot failure rolls back authorisation.
- `state_model.run`: run ID -> exactly one job and snapshot, optional agentRunId/registered agent, execution credential ID and claimed timestamp. Run ID is deterministically scoped by organisation, job and claim identity, including legacy claims without agentRunId.
- `state_model.run_state`: append-only status observations, reason, checkpoint/result and server-observed start/finish times. Existing callback events preserve the client-reported occurredAt separately.
- `state_model.browser`: retained Selenium session ID -> the exact run and execution owner. `RETAINED_AT_HANDOFF` describes an observation, not a claim that the browser is still alive. releasedAt remains unknown.

The service validates organisation/job ownership, validates any application link against both organisation and project, and validates execution credential/agent ownership. Unresolvable historical application identities are marked LEGACY_UNLINKED; no foreign or guessed application relationship is created. Journal readers filter both organisation and job, including dereferencing snapshot pointers.

Snapshot and run data are append-only through this service (`upsert` uses an empty update). This does not prohibit a privileged database operator from editing JSON; database-level append-only enforcement and retention are future work.

## Authorised payload guarantee and compatibility

New authorisations pin one archived snapshot to the existing authorisation timestamp. New runs pin their exact snapshot. Desktop job reads and document-membership checks resolve the run's snapshot first, then the authorised snapshot, then use the legacy job payload **only if no new pointer exists**. A broken new pointer fails closed instead of silently switching inputs.

Later edits to application/client/site/project data cannot replace the pinned desktop payload. Explicit authorisation through existing routes can select a new snapshot; previously recorded versions remain. A run's existing snapshot binding does not change on subsequent callbacks. Current preparation fields remain editable under the existing rules; this phase does not redesign their UI or concurrency model.

Existing queued jobs need no conversion. Their old payload remains readable; when a later claim/callback is observed, ownership can be recorded without reconstructing unknowable historical runs. Missing historical application identity remains unlinked. A fresh retry continues to create a new job and retain its existing fresh_retry_created event; the model additionally supports multiple observed claims on one job without erasing earlier runs.

## API and desktop additions

- Desktop job GET adds `job.stateModel = { version: 1, retainedBrowserMetadata: true }`. Existing fields and snapshot/callback versions remain unchanged.
- Callback v1 accepts optional `result.browserSessionId`. Run, organisation and agent identity are derived on the server from the authenticated current claim, never accepted from browser metadata.
- RuntimeJob metadata carries the server advertisement. Updated desktop agents emit browserSessionId only when the server advertises support; otherwise their payload is unchanged. Older agents need not send it.
- Runner results report the Selenium ID only after the existing successful browser handoff; window handling, submission and Selenium navigation are unchanged.
- Recording hooks are inside existing automatic/manual claims, handoff exchange, callback, retry and lease-reconciliation transactions. Portal job-status updates are wrapped with their journal write. Authorisation now includes snapshot recording atomically, without changing eligibility, timestamps or queue ordering.
- No new public mutation endpoint and no new authentication flow.

## State diagram

```text
Project
  +-- PlanningApplication / BuildingWarrantApplication
        +-- editable current fields (updatedAt revision)
        +-- authorised snapshot [immutable journal record]
              +-- AutomationJob [existing queue identity]
                    +-- Run A [existing claim owner + immutable history]
                    |     +-- retained browser observation
                    +-- Run B [when another claim is observed]
                          +-- its own retained browser observation

Draft -> existing preparation -> existing authorisation -> QUEUED
  -> STARTING -> RUNNING -> PREPARED -> architect review
                       +-> NEEDS_ATTENTION
                       +-> INTERRUPTED / FAILED / STOPPED

Application submission: existing architect-controlled lifecycle only
PREPARED does not imply REVIEWED or SUBMITTED.
```

COMPLETED means preparation finished, not submission. AWAITING_PORTAL_REVIEW maps to PREPARED only with a preparation-complete callback outcome; paused_for_manual_input or an unknown outcome maps conservatively to NEEDS_ATTENTION. A connection-lost NEEDS_REVIEW observation maps to INTERRUPTED. Existing enums and transition rules are not renamed.

## Verification

- `npm run test:state-model` runs the new `tests/automation-state-model.test.ts`: both application types; legacy v1/current v2/ambiguous records; immutable snapshots; authorisation rollback; multiple runs; browser/run ownership; organisation isolation; preparation/submission separation; legacy and extended callback validation; actual desktop GET route serialization and pinned inputs after edits; actual PATCH start/result handling, duplicate callback delivery and stale-owner rejection.
- Extended atomic-postcode-recovery harness invokes actual snapshot recording inside its rollback-capable simulated transaction.
- New desktop `tests/test_state_model_metadata.py`: old-server omission, negotiated metadata, missing browser ID and paused-input outcome.
- Existing orchestration suite, fee tests, snapshot-race, execution-exclusivity and atomic retry tests pass. Security/preparation suite reaches its pre-existing desktop-status source assertion failure (expects an older `where: { id: job.id }` pattern in complete-details).
- Prisma validation/generation pass; no migration is applied. Type checking has only the two pre-existing Lucide `class` versus `className` errors in Settings. No lint script/configuration is present in either repository; Python compile checks are used as syntax checks, not claimed as linting.
- Full desktop suite: **340 passed, 4 subtests passed**, with two unrelated GUI failures: onboarding credential expectation and the old fee-handoff heading. The latter expects text changed before Phase 0; Phase 0 does not edit either failing UI path.
- Service/endpoint database tests use rollback-capable in-memory boundaries. They do not prove PostgreSQL locking under load. No live database mutation or government-portal submission was performed.

## Rollout and remaining debt

Deploy the portal/API independently; no database migration is needed. Older desktop agents continue operating without browser metadata. Updated desktops can run against an older API and omit the unadvertised metadata. Keep an API that has advertised this callback extension available until its outstanding callbacks are delivered; downgrading to a strict older callback validator during an in-flight run needs operational coordination.

Deferred deliberately:

- Real agent connection-session IDs, run-based reveal UX, browser liveness and close/release acknowledgement.
- Full draft revision counters, aggregate optimistic concurrency and IndexedDB recovery.
- Database-enforced append-only journal policy, dedicated indexed projections/tables if history volume warrants them, and retention policy. Existing parent deletion cascades are unchanged.
- Historical run reconstruction: missing history cannot safely be invented.
- Document binary versioning: membership and metadata are pinned; the existing document-download implementation still resolves stored bytes through ProjectDocument. No new blob-versioning mechanism is introduced.
- Guided recovery, new release controls, changed queue authorization, quiet browsers, shared corrections and the other later-phase UX.
- The portal's existing job-status and preparation mutation races are not comprehensively redesigned here. New snapshot history protects authorised execution inputs; broader transition/concurrency hardening requires its own tests and phase.
